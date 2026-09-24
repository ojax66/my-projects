class_name NeuroChem
extends RefCounted
## Hormonios e neuromoduladores na hemolinfa. O cerebro "injeta" quimicos:
## a atividade dos neuronios neuroendocrinos e modulatorios do conectoma
## (IPC, DH44/ISN, OA-*, 5-HT, LK, PAM/PPL1) libera cada substancia, que se
## acumula e decai com sua propria constante de tempo, e volta a modular os
## sensores, a motivacao e a plasticidade.
##
##  insulina (IPC)      saciedade: menos sensibilidade ao acucar e ao cheiro
##  DH44 / ISN          fome: mais busca por comida
##  AKH (corpo)         jejum prolongado: mais locomocao (hiperatividade)
##  octopamina (OA)     alerta/luta-ou-fuga: mais locomocao, aprende mais
##  serotonina (5-HT)   inibe a alimentacao
##  leucocinina (LK)    ritmo/saciedade hidrica: acalma
##  dopamina PAM / PPL1 sinais de recompensa e punicao (ensinam o corpo cogumelo)

const TAU := {
	"insulina": 25.0, "DH44": 15.0, "AKH": 40.0, "octopamina": 3.0,
	"serotonina": 6.0, "leucocinina": 10.0, "dopamina+": 1.0, "dopamina-": 1.0,
}
const SOURCE := {
	"insulina": ["insulin", 40.0], "DH44": ["dh44", 40.0], "octopamina": ["octopamine", 15.0],
	"serotonina": ["serotonin", 20.0], "leucocinina": ["leucokinin", 20.0],
	"dopamina+": ["reward_da", 60.0], "dopamina-": ["punish_da", 90.0],
}

var level := {}


func _init() -> void:
	for k: String in TAU:
		level[k] = 0.0
	level["insulina"] = 0.4


## energy 0..1; arousal 0..1 e ingest/punish (0..1) sao usados quando o
## cerebro nao tem os neuronios correspondentes (circuito padrao).
func update(dt: float, brain: FlyBrain, energy: float, arousal: float, ingest: float, punish: float) -> void:
	for k: String in SOURCE:
		var src: Array = SOURCE[k]
		var release: float
		if brain.has_output(src[0]):
			release = brain.output_rate_hz(src[0]) / float(src[1])
		else:
			match k:
				"insulina": release = energy
				"DH44": release = 1.0 - energy
				"octopamina": release = arousal
				"dopamina+": release = ingest
				"dopamina-": release = punish
				_: release = 0.0
		_relax(k, clampf(release, 0.0, 3.0), dt)
	# AKH vem das celulas do corpo cardiaco (fora do cerebro): jejum
	_relax("AKH", clampf((0.35 - energy) * 3.0, 0.0, 1.0), dt)


func _relax(k: String, target: float, dt: float) -> void:
	level[k] = float(level[k]) + (target - float(level[k])) * (1.0 - exp(-dt / float(TAU[k])))


func get_level(k: String) -> float:
	return float(level.get(k, 0.0))
