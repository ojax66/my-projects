# Atalhos para as tarefas mais comuns. Tudo aqui e um wrapper fino sobre os
# scripts em scripts/ — nada acontece so no Makefile.
SHELL := /bin/bash
TF    := terraform -chdir=terraform

.PHONY: help up down restart logs console status import packs backup restore \
        update tf-init tf-plan tf-apply tf-destroy deploy check test

help: ## mostra esta ajuda
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up:        ## sobe o servidor
	./scripts/mcctl.sh up
down:      ## para o servidor
	./scripts/mcctl.sh down
restart:   ## reinicia (aplica mundos/addons importados)
	./scripts/mcctl.sh restart
logs:      ## acompanha os logs
	./scripts/mcctl.sh logs -f
console:   ## console do servidor (Ctrl-p Ctrl-q para sair)
	./scripts/mcctl.sh console
status:    ## estado do container e ping
	./scripts/mcctl.sh status
import:    ## importa tudo de server/incoming
	./scripts/mcctl.sh import
packs:     ## lista mundos e addons
	./scripts/mcctl.sh packs
backup:    ## backup manual
	./scripts/backup.sh
restore:   ## restaura o backup mais recente
	./scripts/restore.sh
update:    ## atualiza a imagem do servidor
	./scripts/mcctl.sh update

tf-init:   ## inicializa o terraform
	$(TF) init
tf-plan:   ## mostra o plano de infraestrutura
	$(TF) plan
tf-apply:  ## cria/atualiza a infraestrutura na Oracle Cloud
	$(TF) apply
tf-destroy: ## destroi a infraestrutura (APAGA A VM E OS MUNDOS)
	$(TF) destroy
deploy:    ## envia o repo para a VM: make deploy HOST=ubuntu@1.2.3.4
	@test -n "$(HOST)" || { echo "uso: make deploy HOST=ubuntu@ip"; exit 1; }
	./scripts/deploy-remote.sh $(HOST)

test:      ## testes (importador, upload e cloud-init)
	python3 tests/test_mcpack.py
	python3 tests/test_uploader.py
	python3 tests/test_cloud_init.py

check:     ## validacoes locais (sintaxe dos scripts e do terraform)
	bash -n scripts/*.sh
	python3 -m py_compile scripts/mcpack.py scripts/uploader.py
	python3 tests/test_mcpack.py
	python3 tests/test_uploader.py
	python3 tests/test_cloud_init.py
	@command -v terraform >/dev/null && $(TF) fmt -check && $(TF) validate || echo "terraform nao instalado; pulando"
	@command -v shellcheck >/dev/null && shellcheck scripts/*.sh || echo "shellcheck nao instalado; pulando"
