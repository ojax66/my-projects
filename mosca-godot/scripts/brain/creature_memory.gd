class_name CreatureMemory
extends RefCounted
## Memoria de longo prazo de UM individuo, usada pela tomada de decisao.
## Comeca ZERADA: ninguem nasce sabendo que o limao e amargo nem onde cai
## fruta. Tudo vem da experiencia propria ou de observar os outros.
##
##  - odores -> valencia: aprendida SO pelo paladar (acucar +, amargo -) ou
##    vendo outro individuo comer/rejeitar a fruta. Sustos, dor e ser pego
##    nao sujam o cheiro da comida (vao para a memoria de perigo), entao a
##    maca nunca fica "negativa".
##  - cada memoria de odor e um prototipo (perfil nos glomerulos); a
##    generalizacao e estreita (cheiros parecidos compartilham um pouco).
##  - perigos: lugares onde algo caiu, machucou ou matou alguem.
##  - medo de objetos caindo: cresce quando e atingida ou VE alguem morrer
##    esmagado; deixa a criatura atenta e faz ela desviar.
## A taxa de aprendizado e modulada pela dopamina que o cerebro libera.

const MAX_PROTOS := 24
const MAX_DANGER := 16
const SHARP := 40.0          # quanto maior, menos generalizacao entre cheiros

var protos: Array = []       # [PackedFloat32Array perfil, valencia, experiencia, rotulo]
var dangers: Array = []      # [Vector3 pos, raio, forca, o que]
var fall_fear := 0.0         # 0..1
var learned := 0             # contagem de eventos de aprendizado
var observed := 0            # quantos vieram de observar outros


static func norm(v: PackedFloat32Array) -> PackedFloat32Array:
	var s := 0.0
	for x in v:
		s += x * x
	s = sqrt(s)
	var out := v.duplicate()
	if s > 1e-6:
		for i in out.size():
			out[i] /= s
	return out


static func _cos(a: PackedFloat32Array, b: PackedFloat32Array) -> float:
	var s := 0.0
	for i in mini(a.size(), b.size()):
		s += a[i] * b[i]
	return s


## us: +1 recompensa (acucar), -1 punicao (amargo). rate 0..1.
func learn_odor(profile: PackedFloat32Array, us: float, rate: float, label := "", social := false) -> void:
	if profile.is_empty() or rate <= 0.0:
		return
	var v := norm(profile)
	var best := -1
	var best_s := 0.0
	for i in protos.size():
		var s := _cos(v, protos[i][0])
		if s > best_s:
			best_s = s
			best = i
	learned += 1
	if social:
		observed += 1
	if best >= 0 and best_s > 0.96:
		var p: Array = protos[best]
		p[1] = clampf(float(p[1]) + rate * (us - float(p[1])), -1.0, 1.0)
		p[2] = float(p[2]) + rate
		var pv: PackedFloat32Array = p[0]
		for i in pv.size():
			pv[i] = lerpf(pv[i], v[i], 0.1)
		p[0] = norm(pv)
		if label != "":
			p[3] = label
		return
	protos.append([v, clampf(rate * us, -1.0, 1.0), rate, label])
	if protos.size() > MAX_PROTOS:
		var weakest := 0
		for i in protos.size():
			if absf(float(protos[i][1])) * float(protos[i][2]) < absf(float(protos[weakest][1])) * float(protos[weakest][2]):
				weakest = i
		protos.remove_at(weakest)


## Valencia esperada de um cheiro (x) e confianca (y, 0..1).
func predict(profile: PackedFloat32Array) -> Vector2:
	if protos.is_empty() or profile.is_empty():
		return Vector2.ZERO
	var v := norm(profile)
	var ws := 0.0
	var vs := 0.0
	for p: Array in protos:
		var s := maxf(_cos(v, p[0]), 0.0)
		var w := pow(s, SHARP) * clampf(float(p[2]) * 2.0, 0.2, 1.0)
		ws += w
		vs += w * float(p[1])
	if ws < 1e-4:
		return Vector2.ZERO
	return Vector2(vs / ws, clampf(ws, 0.0, 1.0))


## Quanto este cheiro e desconhecido (1 = nunca provou nada parecido).
func novelty(profile: PackedFloat32Array) -> float:
	return 1.0 - predict(profile).y


func add_danger(pos: Vector3, radius: float, strength: float, what: String) -> void:
	learned += 1
	for d: Array in dangers:
		if (d[0] as Vector3).distance_to(pos) < float(d[1]) * 0.7:
			d[2] = minf(float(d[2]) + strength, 1.0)
			d[1] = maxf(float(d[1]), radius)
			d[3] = what
			return
	dangers.append([pos, radius, minf(strength, 1.0), what])
	if dangers.size() > MAX_DANGER:
		var weakest := 0
		for i in dangers.size():
			if float(dangers[i][2]) < float(dangers[weakest][2]):
				weakest = i
		dangers.remove_at(weakest)


## 0..1: quao perigoso este lugar parece.
func danger_at(pos: Vector3) -> float:
	var m := 0.0
	for d: Array in dangers:
		var r: float = d[1]
		var dist := (d[0] as Vector3).distance_to(pos)
		if dist < r * 2.5:
			m = maxf(m, float(d[2]) * exp(-dist * dist / (r * r)))
	return m


## Ponto de perigo mais proximo (para fugir dele).
func nearest_danger(pos: Vector3) -> Vector3:
	var best := Vector3.INF
	var bd := INF
	for d: Array in dangers:
		var dist := (d[0] as Vector3).distance_to(pos)
		if dist < bd:
			bd = dist
			best = d[0]
	return best


func scare(amount: float) -> void:
	fall_fear = clampf(fall_fear + amount, 0.0, 1.0)


## Esquecimento lento (dt em segundos de jogo).
func decay(dt: float) -> void:
	fall_fear = maxf(0.0, fall_fear - dt / 1500.0)
	for i in range(dangers.size() - 1, -1, -1):
		dangers[i][2] = float(dangers[i][2]) - dt / 2400.0
		if float(dangers[i][2]) <= 0.02:
			dangers.remove_at(i)


func summary(max_items := 4) -> String:
	if protos.is_empty() and dangers.is_empty() and fall_fear < 0.01:
		return "vazia (nasceu sem saber nada)"
	var items: Array = protos.duplicate()
	items.sort_custom(func(a, b): return absf(float(a[1])) > absf(float(b[1])))
	var parts: PackedStringArray = []
	for i in mini(items.size(), max_items):
		var p: Array = items[i]
		parts.append("%s %+.2f" % [p[3] if str(p[3]) != "" else "cheiro", float(p[1])])
	if not dangers.is_empty():
		parts.append("%d lugar(es) perigoso(s)" % dangers.size())
	if fall_fear > 0.01:
		parts.append("medo de queda %d%%" % int(fall_fear * 100))
	if observed > 0:
		parts.append("%d aprendido(s) observando" % observed)
	return ", ".join(parts)


# ---------------------------------------------------------------- heranca e arquivo
static func inherit(a: CreatureMemory, b: CreatureMemory, fraction: float) -> CreatureMemory:
	var m := CreatureMemory.new()
	for src: CreatureMemory in [a, b]:
		if src == null:
			continue
		for p: Array in src.protos:
			m.learn_odor(p[0], float(p[1]), fraction * 0.5 * absf(float(p[1])) + 0.001, p[3])
		m.fall_fear = maxf(m.fall_fear, src.fall_fear * fraction)
	m.learned = 0
	m.observed = 0
	return m


## Metamorfose: o corpo cogumelo da larva e remodelado na pupa e parte das
## memorias sobrevive no adulto (Tully et al. 1994). keep = fracao mantida.
static func metamorphosis(src: CreatureMemory, keep: float) -> CreatureMemory:
	var m := CreatureMemory.new()
	if src == null:
		return m
	for p: Array in src.protos:
		m.protos.append([(p[0] as PackedFloat32Array).duplicate(), float(p[1]) * keep, float(p[2]) * keep, p[3]])
	for d: Array in src.dangers:
		m.dangers.append([d[0], d[1], float(d[2]) * keep * 0.7, d[3]])
	m.fall_fear = src.fall_fear * keep
	m.learned = src.learned
	m.observed = src.observed
	return m


func to_dict() -> Dictionary:
	var ps: Array = []
	for p: Array in protos:
		ps.append({"perfil": Array(p[0] as PackedFloat32Array), "valencia": p[1], "experiencia": p[2], "rotulo": p[3]})
	var ds: Array = []
	for d: Array in dangers:
		var v: Vector3 = d[0]
		ds.append({"pos": [v.x, v.y, v.z], "raio": d[1], "forca": d[2], "o_que": d[3]})
	return {"odores": ps, "perigos": ds, "medo_de_queda": fall_fear, "aprendizados": learned, "observados": observed}


static func from_dict(d: Dictionary) -> CreatureMemory:
	var m := CreatureMemory.new()
	for p: Dictionary in d.get("odores", []):
		m.protos.append([PackedFloat32Array(p.get("perfil", [])), float(p.get("valencia", 0.0)), float(p.get("experiencia", 0.0)), str(p.get("rotulo", ""))])
	for q: Dictionary in d.get("perigos", []):
		var a: Array = q.get("pos", [0, 0, 0])
		m.dangers.append([Vector3(a[0], a[1], a[2]), float(q.get("raio", 150.0)), float(q.get("forca", 0.5)), str(q.get("o_que", ""))])
	m.fall_fear = float(d.get("medo_de_queda", 0.0))
	m.learned = int(d.get("aprendizados", 0))
	m.observed = int(d.get("observados", 0))
	return m
