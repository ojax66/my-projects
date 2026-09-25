class_name AmphibianRetina
extends RefCounted
## Olhos que enxergam o ambiente com raios de verdade.
##
## Cada olho tem uma grade de fotorreceptores (raios) apontando para o seu
## campo visual (os olhos da ra ficam dos lados e em cima da cabeca: quase
## 360 graus, com uma faixa binocular na frente). A cada olhada:
##   - cada raio mede o que enxerga (ceu claro, chao, pedra, fruta...) e a
##     distancia; a luminancia depende do sol/lua
##   - escurecimento e expansao (algo grande chegando perto) de uma olhada
##     para a outra -> ganglionares R3/R4 -> "sombra" (ameaca)
##   - pontinhos que se mexem: para cada objeto pequeno no campo visual o olho
##     lanca um raio de linha de visao (se tiver uma pedra/fruta na frente,
##     nao ve). O movimento e medido pela mudanca de posicao entre olhadas,
##     nao lido do objeto -> ganglionares R2 ("detectores de inseto") -> presa
##   - binocular: presa na faixa frontal e perto -> "presa_perto" (a ra calcula
##     a distancia com os dois olhos antes de disparar a lingua)

const MASK_SCENE := 1 | 2
const MASK_SMALL := 1 | 2 | 4

var cols := 10
var rows := 5
var fov_h := deg_to_rad(165.0)   # por olho
var fov_v := deg_to_rad(95.0)
var view_range := 1500.0
var small_max_rad := 0.3         # objeto maior que isso (raio angular) nao e presa
var binocular := deg_to_rad(28.0)
var near_range := 60.0

var _prev_depth := {}            # [olho, i] -> distancia
var _prev_lum := {}
var _prev_pos := {}              # instance_id -> posicao na olhada anterior
var _t := 0.0
var _last_xf := Transform3D()
var _has_xf := false

# resultados (Hz)
var prey := {"L": 0.0, "R": 0.0}
var prey_near := 0.0
var threat := {"L": 0.0, "R": 0.0}
var light := {"L": 0.0, "R": 0.0}
var target: Node3D = null         # o pontinho mais saliente
var target_kind := ""
var target_speed := 0.0
var threat_dir := Vector3.ZERO
var pixels := PackedFloat32Array()   # luminancia dos dois olhos (painel)


## owner: o no do bicho; eyes: [[posicao global, direcao central global, "L"/"R"], ...]
func look(owner: Node3D, eyes: Array, dt: float, candidates: Array) -> void:
	_t += dt
	var space := owner.get_world_3d().direct_space_state
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	var sky := 0.08 + 0.92 * dl
	pixels.resize(eyes.size() * cols * rows)
	# o proprio movimento (virar, pular) muda toda a imagem: como o cerebro
	# de verdade (copia eferente), nao conta isso como ameaca
	var xf := owner.global_transform
	var self_moving := _has_xf and (xf.origin.distance_to(_last_xf.origin) > 1.5 or \
		(xf.basis.z.normalized()).angle_to(_last_xf.basis.z.normalized()) > 0.03)
	_last_xf = xf
	_has_xf = true
	var prev_threat := threat.duplicate()
	threat = {"L": 0.0, "R": 0.0}
	light = {"L": 0.0, "R": 0.0}
	threat_dir = Vector3.ZERO
	var up := owner.global_basis.y.normalized()
	var ei := 0
	for eye: Array in eyes:
		var pos: Vector3 = eye[0]
		var fwd: Vector3 = (eye[1] as Vector3).normalized()
		var side: String = eye[2]
		var right := fwd.cross(up).normalized()
		var eup := right.cross(fwd).normalized()
		var dim := 0.0
		var expand := 0
		var lum_sum := 0.0
		for r in rows:
			for c in cols:
				var az := (float(c) / (cols - 1) - 0.5) * fov_h
				var el := (float(r) / (rows - 1) - 0.4) * fov_v
				var dir := (fwd * cos(az) * cos(el) + right * sin(az) * cos(el) + eup * sin(el)).normalized()
				var q := PhysicsRayQueryParameters3D.create(pos, pos + dir * view_range, MASK_SCENE)
				var hit := space.intersect_ray(q)
				var depth := view_range
				var lum := sky * (0.9 if dir.dot(Vector3.UP) > 0.0 else 0.3)
				if hit:
					depth = pos.distance_to(hit.position)
					var n: Vector3 = hit.normal
					var albedo := 0.35
					var col: Object = hit.collider
					if col is Fruit:
						albedo = 0.55
					elif col is Prop:
						albedo = 0.45
					lum = sky * albedo * (0.4 + 0.6 * maxf(n.dot(Vector3.UP), 0.0))
				var key := ei * 1000 + r * cols + c
				var pd: float = _prev_depth.get(key, depth)
				var pl: float = _prev_lum.get(key, lum)
				# algo chegou perto (a distancia caiu muito) e escureceu
				if depth < pd * 0.75 and depth < 800.0:
					expand += 1
					threat_dir += -dir
				dim += maxf(0.0, pl - lum)
				_prev_depth[key] = depth
				_prev_lum[key] = lum
				lum_sum += lum
				pixels[ei * cols * rows + r * cols + c] = lum
		var n_px := float(cols * rows)
		# R3/R4: escurecimento + expansao de muitos pixels = ameaca grande
		if self_moving:
			threat[side] = float(prev_threat.get(side, 0.0)) * 0.5
		else:
			threat[side] = clampf(expand / n_px * 900.0 + dim / n_px * 600.0, 0.0, 220.0)
		light[side] = 20.0 + 100.0 * lum_sum / n_px
		ei += 1
	_scan_small(owner, eyes, dt, candidates, space)


## R2: pontinhos em movimento. candidates: [[no, tipo, raio], ...]
func _scan_small(owner: Node3D, eyes: Array, dt: float, candidates: Array, space: PhysicsDirectSpaceState3D) -> void:
	prey = {"L": 0.0, "R": 0.0}
	prey_near = 0.0
	target = null
	target_kind = ""
	var best := 0.0
	var head_fwd := (-owner.global_basis.z).normalized()
	var seen := {}
	for cnd: Array in candidates:
		var node: Node3D = cnd[0]
		if not is_instance_valid(node):
			continue
		var kind: String = cnd[1]
		var r: float = cnd[2]
		var id := node.get_instance_id()
		var p := node.global_position
		var prev: Vector3 = _prev_pos.get(id, p)
		seen[id] = p
		var speed := p.distance_to(prev) / maxf(dt, 1e-3)
		for eye: Array in eyes:
			var epos: Vector3 = eye[0]
			var efwd: Vector3 = (eye[1] as Vector3).normalized()
			var side: String = eye[2]
			var to := p - epos
			var d := to.length()
			if d > view_range * 0.35 or d < 0.5:
				continue
			if to.normalized().dot(efwd) < cos(fov_h * 0.5):
				continue   # fora do campo deste olho
			var ang := r / d
			if ang > small_max_rad:
				continue
			# linha de visao (pedras e frutas tapam)
			var q := PhysicsRayQueryParameters3D.create(epos, p, MASK_SCENE)
			var blk := space.intersect_ray(q)
			if blk and epos.distance_to(blk.position) < d - r - 1.0 and blk.collider != node:
				continue
			if speed < 2.0:
				continue   # a retina da ra quase nao ve o que esta parado
			var rate := 170.0 * clampf(speed / 30.0, 0.25, 1.0) * clampf(ang * 30.0, 0.2, 1.0) * clampf(1.0 - d / (view_range * 0.35), 0.0, 1.0)
			prey[side] = maxf(prey[side], rate)
			var front := to.normalized().dot(head_fwd)
			if front > cos(binocular) and d < near_range:
				prey_near = maxf(prey_near, 160.0 * clampf(1.0 - d / near_range, 0.3, 1.0))
			if rate > best:
				best = rate
				target = node
				target_kind = kind
				target_speed = speed
	_prev_pos = seen
