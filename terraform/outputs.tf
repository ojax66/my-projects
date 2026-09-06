locals {
  public_ip = var.reserve_public_ip ? oci_core_public_ip.this[0].ip_address : oci_core_instance.this.public_ip
}

output "public_ip" {
  description = "IP publico da VM."
  value       = local.public_ip
}

output "minecraft_address" {
  description = "Endereco e porta para adicionar no jogo."
  value       = "${local.public_ip}:${var.server_port}"
}

output "ssh_command" {
  description = "Como acessar a VM."
  value       = "ssh ubuntu@${local.public_ip}"
}

output "deploy_command" {
  description = "Publica os scripts do repositorio na VM."
  value       = "scripts/deploy-remote.sh ubuntu@${local.public_ip}"
}

output "instance_id" {
  description = "OCID da instancia."
  value       = oci_core_instance.this.id
}
