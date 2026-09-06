data "oci_core_images" "os" {
  compartment_id           = var.compartment_ocid
  operating_system         = var.operating_system
  operating_system_version = var.operating_system_version
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "this" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.ad
  display_name        = "${local.name}-server"
  shape               = var.shape
  freeform_tags       = var.tags

  # shape_config so tem efeito em shapes .Flex; nos demais e ignorado pela API
  dynamic "shape_config" {
    for_each = endswith(var.shape, ".Flex") ? [1] : []
    content {
      ocpus         = var.ocpus
      memory_in_gbs = var.memory_in_gbs
    }
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.os.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_size_in_gbs
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.this.id
    assign_public_ip = !var.reserve_public_ip
    display_name     = "${local.name}-vnic"
    hostname_label   = local.name
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      server_name    = var.server_name
      server_version = var.server_version
      level_name     = var.level_name
      gamemode       = var.gamemode
      difficulty     = var.difficulty
      max_players    = var.max_players
      ops_xuids      = var.ops_xuids
      server_port    = var.server_port
      memory_limit   = "${max(floor(var.memory_in_gbs * 0.75), 1)}g"
      repo_url       = var.repo_url
    }))
  }

  lifecycle {
    # Recriar a VM por causa de uma imagem nova apagaria os mundos.
    ignore_changes = [source_details[0].source_id, metadata["user_data"]]
  }
}

# --- IP publico reservado (opcional) ---------------------------------------- #
# Um IP reservado sobrevive a stop/start da VM: os jogadores nao precisam
# reconfigurar o endereco do servidor.
data "oci_core_vnic_attachments" "this" {
  count               = var.reserve_public_ip ? 1 : 0
  compartment_id      = var.compartment_ocid
  instance_id         = oci_core_instance.this.id
  availability_domain = local.ad
}

data "oci_core_private_ips" "this" {
  count   = var.reserve_public_ip ? 1 : 0
  vnic_id = data.oci_core_vnic_attachments.this[0].vnic_attachments[0]["vnic_id"]
}

resource "oci_core_public_ip" "this" {
  count          = var.reserve_public_ip ? 1 : 0
  compartment_id = var.compartment_ocid
  display_name   = "${local.name}-ip"
  lifetime       = "RESERVED"
  private_ip_id  = data.oci_core_private_ips.this[0].private_ips[0]["id"]
  freeform_tags  = var.tags
}
