class_name FlyCPG
extends RefCounted
## Rede de osciladores acoplados (CPG) como em flygym_demo/complex_terrain:
##   dθi/dt = 2π νi + Σj rj wij sin(θj − θi − φij)
##   dri/dt = α (Ri − ri)
## A fase de cada perna indexa passadas reais gravadas (single_steps_untethered),
## e a amplitude r escala o desvio em relacao a pose neutra (fase π).
## Ordem das pernas: lf, lm, lh, rf, rm, rh.

const LEGS := ["lf", "lm", "lh", "rf", "rm", "rh"]

var intrinsic_freq := 12.0     # Hz (valor padrao do flygym)
var coupling := 10.0
var convergence := 20.0

var phases := PackedFloat32Array([0, 0, 0, 0, 0, 0])
var amps := PackedFloat32Array([0, 0, 0, 0, 0, 0])
var target_amps := PackedFloat32Array([0, 0, 0, 0, 0, 0])
var freqs := PackedFloat32Array([12, 12, 12, 12, 12, 12])

var _bias: Array = []
var _samples := 0
var _angles: Dictionary = {}   # perna -> Array[PackedFloat32Array] (7 dofs x amostras)
var _neutral: Dictionary = {}  # perna -> PackedFloat32Array (7)


func _init() -> void:
	var m := FlyBody.model()
	_bias = m["tripod_phase_bias"]
	var step: Dictionary = m["step"]
	_samples = int(step["samples"])
	for leg: String in LEGS:
		var rows: Array = []
		for row: Array in step["angles"][leg]:
			rows.append(PackedFloat32Array(row))
		_angles[leg] = rows
		var neutral := PackedFloat32Array()
		for d in 7:
			neutral.append(_sample(rows[d], PI))
		_neutral[leg] = neutral
	for i in 6:
		# comeca ja em tripode
		phases[i] = 0.0 if i in [0, 2, 4] else PI


## drive_l / drive_r: sinal descendente por lado (como o TurningController do
## flygym). |d| -> amplitude, sinal -> sentido (negativo = andar para tras).
func set_descending(drive_l: float, drive_r: float, freq_scale := 1.0) -> void:
	for i in 6:
		var d := drive_l if i < 3 else drive_r
		target_amps[i] = clampf(absf(d), 0.0, 1.5)
		freqs[i] = intrinsic_freq * freq_scale * (1.0 if d >= 0.0 else -1.0)


func step(dt: float) -> void:
	# integra em sub-passos para estabilidade (α=20 exige dt pequeno)
	var n := maxi(1, ceili(dt / 0.002))
	var h := dt / n
	for _k in n:
		var dphi := PackedFloat32Array([0, 0, 0, 0, 0, 0])
		for i in 6:
			var s := TAU * freqs[i]
			var row: Array = _bias[i]
			for j in 6:
				var b: float = row[j]
				if b > 0.0:
					s += amps[j] * coupling * sin(phases[j] - phases[i] - b)
			dphi[i] = s
		for i in 6:
			phases[i] = fposmod(phases[i] + dphi[i] * h, TAU)
			amps[i] += convergence * (target_amps[i] - amps[i]) * h


## 7 angulos da perna (coxa pitch/roll/yaw, femur pitch/roll, tibia, tarso1)
func leg_angles(leg_idx: int) -> PackedFloat32Array:
	var leg: String = LEGS[leg_idx]
	var rows: Array = _angles[leg]
	var neutral: PackedFloat32Array = _neutral[leg]
	var out := PackedFloat32Array()
	out.resize(7)
	var r := amps[leg_idx]
	for d in 7:
		var v := _sample(rows[d], phases[leg_idx])
		out[d] = neutral[d] + r * (v - neutral[d])
	return out


func mean_amp(side: int) -> float:
	var o := side * 3
	return (amps[o] + amps[o + 1] + amps[o + 2]) / 3.0


func _sample(row: PackedFloat32Array, phase: float) -> float:
	var x := fposmod(phase, TAU) / TAU * (_samples - 1)
	var i := int(x)
	var f := x - i
	var j := mini(i + 1, _samples - 1)
	return lerpf(row[i], row[j], f)
