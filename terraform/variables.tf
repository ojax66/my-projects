# --- autenticacao / localizacao -------------------------------------------- #
variable "auth_method" {
  description = "Metodo de autenticacao do provider OCI."
  type        = string
  default     = "ApiKey" # ou InstancePrincipal / SecurityToken
}

variable "config_file_profile" {
  description = "Perfil em ~/.oci/config (criado por `oci setup config`)."
  type        = string
  default     = "DEFAULT"
}

variable "region" {
  description = "Regiao OCI, ex.: sa-saopaulo-1, sa-vinhedo-1, us-ashburn-1."
  type        = string
}

variable "compartment_ocid" {
  description = "OCID do compartimento onde os recursos serao criados."
  type        = string
}

variable "availability_domain" {
  description = "Nome do AD. Vazio = usa o primeiro disponivel na regiao."
  type        = string
  default     = ""
}

# --- projeto ---------------------------------------------------------------- #
variable "project_name" {
  description = "Prefixo usado no nome dos recursos."
  type        = string
  default     = "mcbe"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project_name))
    error_message = "Use minusculas, digitos e hifens (2 a 21 caracteres)."
  }
}

variable "tags" {
  description = "Freeform tags aplicadas aos recursos."
  type        = map(string)
  default     = { project = "minecraft-bedrock" }
}

# --- computacao ------------------------------------------------------------- #
# Sempre Free (Ampere A1): ate 4 OCPUs e 24 GB somados entre todas as VMs A1.
# A imagem itzg roda o servidor x86 sob box64 no ARM: funciona, com perda de
# desempenho. Para x86 puro use VM.Standard.E2.1.Micro (1 OCPU / 1 GB).
variable "shape" {
  description = "Shape da VM."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  description = "OCPUs (apenas para shapes .Flex)."
  type        = number
  default     = 2
}

variable "memory_in_gbs" {
  description = "Memoria em GB (apenas para shapes .Flex)."
  type        = number
  default     = 12
}

variable "boot_volume_size_in_gbs" {
  description = "Tamanho do boot volume. O free tier soma 200 GB."
  type        = number
  default     = 100
}

variable "operating_system" {
  description = "Sistema operacional da imagem."
  type        = string
  default     = "Canonical Ubuntu"
}

variable "operating_system_version" {
  description = "Versao do sistema operacional."
  type        = string
  default     = "22.04"
}

variable "ssh_public_key" {
  description = "Chave publica SSH (conteudo de ~/.ssh/id_ed25519.pub)."
  type        = string
}

# --- rede ------------------------------------------------------------------- #
variable "vcn_cidr" {
  description = "CIDR da VCN."
  type        = string
  default     = "10.42.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR da subnet publica."
  type        = string
  default     = "10.42.1.0/24"
}

variable "ssh_allowed_cidr" {
  description = "De onde o SSH e permitido. Restrinja ao seu IP (ex.: 203.0.113.7/32)."
  type        = string
  default     = "0.0.0.0/0"
}

variable "game_allowed_cidr" {
  description = "De onde os jogadores podem conectar."
  type        = string
  default     = "0.0.0.0/0"
}

variable "server_port" {
  description = "Porta UDP do servidor (IPv4). A porta IPv6 e server_port + 1."
  type        = number
  default     = 19132
}

variable "reserve_public_ip" {
  description = "IP publico reservado: nao muda quando a VM e parada/reiniciada."
  type        = bool
  default     = true
}

# --- servidor --------------------------------------------------------------- #
variable "server_name" {
  description = "Nome exibido na lista de servidores do jogo."
  type        = string
  default     = "Bedrock na Oracle Cloud"
}

variable "server_version" {
  description = "Versao do Bedrock (LATEST ou fixa, ex.: 1.21.44.01)."
  type        = string
  default     = "LATEST"
}

variable "level_name" {
  description = "Diretorio do mundo ativo em server/data/worlds."
  type        = string
  default     = "world"
}

variable "gamemode" {
  description = "survival, creative ou adventure."
  type        = string
  default     = "survival"
}

variable "difficulty" {
  description = "peaceful, easy, normal ou hard."
  type        = string
  default     = "normal"
}

variable "max_players" {
  description = "Numero maximo de jogadores."
  type        = number
  default     = 10
}

variable "ops_xuids" {
  description = "XUIDs de operadores, separados por virgula."
  type        = string
  default     = ""
}

variable "repo_url" {
  description = "Repositorio git clonado na VM para trazer os scripts (opcional; use scripts/deploy-remote.sh se for privado)."
  type        = string
  default     = ""
}
