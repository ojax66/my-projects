terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
  }
}

provider "oci" {
  auth                = var.auth_method
  config_file_profile = var.config_file_profile
  region              = var.region
}
