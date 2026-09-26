class_name FrogLimbs
extends RefCounted
## Musculos das juntas da ra. Cada junta tem um par de motoneuronios no
## conectoma (extensor e flexor, ou para a frente e para tras no ombro): a
## ativacao do musculo segue o disparo (~25 ms), e a junta vai para o angulo
## de equilibrio entre os dois (modelo de ponto de equilibrio, Feldman), rapido
## para estender (o salto e muito rapido: os tendoes guardam energia) e mais
## devagar para recolher. Sem disparo nenhum a junta volta a postura sentada
## (angulo 0) pela elasticidade dos tecidos.

# junta: [saida que estende, saida que flexiona, ganho rad por unidade, min, max, tau estender, tau recolher]
const LEG := {
	"quadril": ["quadril_ext", "quadril_flex", 1.5, -0.2, 2.0, 0.035, 0.07],
	"joelho": ["joelho_ext", "joelho_flex", 1.8, -0.15, 2.4, 0.03, 0.07],
	"tornozelo": ["tornozelo_ext", "tornozelo_flex", 1.8, -0.15, 2.3, 0.03, 0.07],
	"tarso": ["tarso_ext", "tarso_flex", 0.8, -0.3, 0.8, 0.03, 0.06],
}
const ARM := {
	"ombro": ["ombro_frente", "ombro_tras", 1.1, -1.1, 1.2, 0.05, 0.05],
	"ombro_baixo": ["ombro_baixo", "ombro_cima", 0.55, -0.9, 0.55, 0.05, 0.05],
	"cotovelo": ["cotovelo_ext", "cotovelo_flex", 1.0, -1.7, 1.0, 0.045, 0.05],
	"punho": ["punho_ext", "punho_flex", 0.8, -0.9, 0.7, 0.045, 0.05],
	"dedos": ["dedos_mao", "", 1.0, -0.2, 1.2, 0.05, 0.05],
}

var act := {}                 # ativacao de cada musculo (nome da saida + lado)
var leg := {"L": {}, "R": {}}
var arm := {"L": {}, "R": {}}
var spread := {"L": 0.0, "R": 0.0}   # dedos do pe abertos (membrana)
var warm := 2.5               # o conectoma leva ~2 s para assentar ao nascer


func _init() -> void:
	for s in ["L", "R"]:
		for j in LEG:
			leg[s][j] = 0.0
		leg[s]["dedos"] = 0.0
		for j in ARM:
			arm[s][j] = 0.0


func _a(out: Callable, n: String, dt: float) -> float:
	if n == "":
		return 0.0
	var x := clampf(float(out.call(n)), 0.0, 3.0)
	var v: float = act.get(n, 0.0)
	v = lerpf(v, x, 1.0 - exp(-dt / 0.025))
	act[n] = v
	return v


func _joint(q: Dictionary, j: String, spec: Array, out: Callable, s: String, dt: float, force: float) -> void:
	var e := _a(out, spec[0] + "_" + s, dt) if spec[0] != "" else 0.0
	var f := _a(out, spec[1] + "_" + s, dt) if spec[1] != "" else 0.0
	var target := clampf((e - f) * float(spec[2]) * force, float(spec[3]), float(spec[4]))
	var cur: float = q[j]
	var tau: float = spec[5] if target > cur else spec[6]
	q[j] = lerpf(cur, target, 1.0 - exp(-dt / tau))


## out: Callable(nome) -> saida do conectoma. force: vigor (velhice, defeitos).
func step(dt: float, out: Callable, force: float, missing_leg: String) -> void:
	warm = maxf(0.0, warm - dt)
	var k := force * clampf((0.5 - warm) / 0.5, 0.0, 1.0)
	for s in ["L", "R"]:
		var q: Dictionary = leg[s]
		for j in LEG:
			_joint(q, j, LEG[j], out, s, dt, 0.0 if missing_leg == s else k)
		spread[s] = lerpf(spread[s], clampf(_a(out, "dedos_abrir_" + s, dt) * 1.2 * (1.0 if warm <= 0.0 else 0.0), 0.0, 1.0), 1.0 - exp(-dt / 0.04))
		var aq: Dictionary = arm[s]
		for j in ARM:
			_joint(aq, j, ARM[j], out, s, dt, k)


## Ativacao media dos extensores de uma perna (para o shader e o gasto).
func leg_act(s: String) -> float:
	return (float(act.get("quadril_ext_" + s, 0.0)) + float(act.get("joelho_ext_" + s, 0.0))) * 0.5


func arm_act(s: String) -> float:
	var m := 0.0
	for n in ["ombro_frente_", "ombro_tras_", "ombro_baixo_", "cotovelo_ext_", "cotovelo_flex_"]:
		m = maxf(m, float(act.get(n + s, 0.0)))
	return m
