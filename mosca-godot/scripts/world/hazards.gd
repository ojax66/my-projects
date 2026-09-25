class_name Hazards
extends RefCounted
## Objetos pesados em queda (frutas, pedras), calculados uma vez por tick de
## fisica e consultados por todas as criaturas.
##
## Esmagar exige que o objeto caia LITERALMENTE em cima: vindo de cima, em
## queda, e com a criatura embaixo da "pegada" dele no instante em que a
## parte de baixo do objeto passa pela altura do corpo. Estar embaixo de uma
## fruta parada (ou pendurada), ou levar uma batida de lado, nao mata.
## A trajetoria entre dois ticks e verificada inteira (com o tempo acelerado
## uma fruta anda varios centimetros por tick).

const CRUSH_MASS := 0.02       # uma cereja ja pesa ~7x isso; a mosca ~0.001
const FALL_SPEED := 300.0      # mm/s para baixo (queda de ~5 mm ou mais)

static var _frame := -1
static var falling: Array = []     # [rb, pos, prev_pos, vel, raio]
static var moving: Array = []      # objetos rapidos (batidas laterais)
static var _prev := {}             # instance_id -> [pos, vel]


static func refresh(tree: SceneTree) -> void:
	var fr := Engine.get_physics_frames()
	if fr == _frame:
		return
	_frame = fr
	falling.clear()
	moving.clear()
	var seen := {}
	for n in tree.get_nodes_in_group("grabbable"):
		var rb := n as RigidBody3D
		if rb == null or not rb.is_inside_tree():
			continue
		var id := rb.get_instance_id()
		var pos := rb.global_position
		var v := rb.linear_velocity
		var prev: Array = _prev.get(id, [pos, v])
		seen[id] = [pos, v]
		if rb.freeze and not rb.has_meta("held"):
			continue
		var r: float = rb.call("loom_radius") if rb.has_method("loom_radius") else 20.0
		var pv: Vector3 = prev[1]
		if rb.mass >= CRUSH_MASS and (v.y < -FALL_SPEED or pv.y < -FALL_SPEED):
			falling.append([rb, pos, prev[0], v if v.y < pv.y else pv, r])
		elif v.length_squared() > 200.0 * 200.0:
			moving.append([rb, pos, prev[0], v, r])
	_prev = seen


## Verifica se algo caiu em cima de uma criatura em p (base do corpo) com
## altura h e raio de corpo w. Retorna {"crush": objeto} ou {"hit": forca}.
## Um objeto que o jogador esta segurando nunca esmaga (so empurra/machuca
## de leve); solto de cima, ele cai e ai pode esmagar.
static func check(p: Vector3, h: float, w: float, ignore: Object) -> Dictionary:
	for item: Array in falling:
		if not is_instance_valid(item[0]) or item[0] == ignore:
			continue
		var rb: RigidBody3D = item[0]
		if rb.has_meta("held"):
			continue   # na mao do jogador: empurra, mas nao "cai" em cima
		var pos: Vector3 = item[1]
		var prev: Vector3 = item[2]
		var r: float = item[4]
		# altura do centro quando a base do objeto toca o topo da criatura
		var y_touch := p.y + h + r
		if prev.y < y_touch - r * 0.15:
			continue   # ja estava ao lado/abaixo: nao veio de cima
		if pos.y > y_touch + 0.5:
			continue   # ainda nao chegou
		var t := clampf((prev.y - y_touch) / maxf(prev.y - pos.y, 1e-3), 0.0, 1.0)
		var at := prev.lerp(pos, t)
		var hor := Vector2(p.x - at.x, p.z - at.z).length()
		if hor < r * 0.8 + w * 0.3:
			return {"crush": rb}
		if hor < r + w:
			return {"hit": 0.35, "obj": rb}
	for item: Array in moving:
		if not is_instance_valid(item[0]) or item[0] == ignore:
			continue
		var rb: RigidBody3D = item[0]
		var r: float = item[4]
		var d := _seg_dist(p + Vector3.UP * h * 0.5, item[2], item[1]) - r
		if d < w:
			var v: Vector3 = item[3]
			var k := 0.3 if rb.has_meta("held") else 1.0
			return {"hit": clampf(v.length() / 1500.0, 0.05, 0.5) * k, "obj": rb}
	return {}


## Ameaca prevista: algum objeto em queda vai cair perto de p? Retorna
## {"t": segundos ate cair, "away": direcao horizontal para fugir, "obj": rb}.
static func threat(p: Vector3, margin: float) -> Dictionary:
	var best := {}
	var best_t := INF
	for item: Array in falling:
		if not is_instance_valid(item[0]):
			continue
		var rb: RigidBody3D = item[0]
		var pos: Vector3 = item[1]
		var v: Vector3 = item[3]
		var r: float = item[4]
		var dy := pos.y - r - p.y
		if dy < -r * 0.2:
			continue
		var vd := maxf(-v.y, 1.0)
		var g := 9800.0
		var t := (-vd + sqrt(vd * vd + 2.0 * g * maxf(dy, 0.0))) / g
		var land := Vector2(pos.x + v.x * t, pos.z + v.z * t)
		var off := Vector2(p.x, p.z) - land
		if off.length() < r + margin and t < best_t:
			best_t = t
			var away := Vector3(off.x, 0, off.y)
			if away.length() < 0.01:
				away = Vector3(randf_range(-1, 1), 0, randf_range(-1, 1))
			best = {"t": t, "away": away.normalized(), "obj": rb, "pos": Vector3(land.x, p.y, land.y), "r": r}
	return best


static func _seg_dist(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var l2 := ab.length_squared()
	if l2 < 1e-6:
		return p.distance_to(a)
	var t := clampf((p - a).dot(ab) / l2, 0.0, 1.0)
	return p.distance_to(a + ab * t)
