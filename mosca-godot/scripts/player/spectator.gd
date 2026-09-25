class_name Spectator
extends Camera3D
## Camera espectadora. Nao tem corpo: voa livre pelo jardim, pode seguir uma
## mosca (orbita) e manipular o mundo (pegar, arremessar, soprar, criar).
##
## Controles (tambem nos botoes da tela):
##   WASD / setas cima-baixo  mover       E/Espaco subir, Q/Ctrl descer
##   setas esq/dir, Z/X        girar       Shift rapido, Alt lento, roda = velocidade
##   botao direito (segurar)   olhar       Tab prende o mouse
##   botao esquerdo (segurar)  pegar e arrastar; solte para arremessar
##   F / botao do meio         soprar      C seguir mosca   1-6 criar itens

signal hover_changed(text: String)
signal message(text: String)

const PICK_MASK := 2 | 4
const SPAWN_MASK := 1 | 2

var world: GardenWorld
var speed := 220.0
var yaw := 0.0
var pitch := -0.35
var follow: Node3D = null
var follow_dist := 16.0
var held: Object = null
var hold_dist := 100.0
var _vel := Vector3.ZERO
var _looking := false
var _hover_text := ""
var _last_pos := Vector3.ZERO
var cam_velocity := Vector3.ZERO
var _puff_fx: CPUParticles3D


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS   # a camera anda mesmo com o jogo pausado
	near = 0.05
	far = 20000.0
	fov = 70.0
	add_to_group("loomer")
	yaw = rotation.y
	pitch = rotation.x
	_puff_fx = CPUParticles3D.new()
	_puff_fx.emitting = false
	_puff_fx.one_shot = true
	_puff_fx.amount = 60
	_puff_fx.lifetime = 0.8
	_puff_fx.explosiveness = 0.9
	_puff_fx.direction = Vector3(0, 0, -1)
	_puff_fx.spread = 12.0
	_puff_fx.initial_velocity_min = 300.0
	_puff_fx.initial_velocity_max = 700.0
	_puff_fx.gravity = Vector3.ZERO
	_puff_fx.damping_min = 300.0
	_puff_fx.damping_max = 500.0
	_puff_fx.scale_amount_min = 3.0
	_puff_fx.scale_amount_max = 8.0
	var qm := SphereMesh.new()
	qm.radius = 1.0
	qm.height = 2.0
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1, 1, 1, 0.25)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	qm.material = mat
	_puff_fx.mesh = qm
	_puff_fx.position = Vector3(0, -8, -20)
	add_child(_puff_fx)


## Raio de "cabeca" do observador para os detectores de looming das moscas.
func loom_radius() -> float:
	return 25.0


# ---------------------------------------------------------------- entrada
# ---------------------------------------------------------------- toque
## Toque (e mouse esquerdo, emulado como toque):
##   arrastar um dedo na tela   -> gira a camera
##   segurar parado ~0,3 s      -> pega o item/criatura embaixo do dedo
##   toque rapido numa criatura -> passa a segui-la
##   dois dedos (pinca)         -> zoom / avancar
const HOLD_TIME := 0.28
const MOVE_TOL := 14.0

var _touches := {}
var _grab_touch := -1
var _hold_screen := Vector2.ZERO
var _pinch_d := 0.0


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			var ui := Hud.instance != null and Hud.instance.is_over_ui(st.position)
			_touches[st.index] = {"start": st.position, "pos": st.position, "t": 0.0, "ui": ui, "moved": false}
			_pinch_d = 0.0
		else:
			var info = _touches.get(st.index)
			if info != null:
				if st.index == _grab_touch:
					_release()
					_grab_touch = -1
				elif not info["ui"] and not info["moved"] and info["t"] < HOLD_TIME:
					_tap(st.position)
			_touches.erase(st.index)
	elif event is InputEventScreenDrag:
		var sd := event as InputEventScreenDrag
		var info = _touches.get(sd.index)
		if info == null or info["ui"]:
			return
		info["pos"] = sd.position
		if (sd.position - info["start"]).length() > MOVE_TOL:
			info["moved"] = true
		if sd.index == _grab_touch:
			_hold_screen = sd.position
			return
		var free := _free_touches()
		if free.size() >= 2:
			var a: Vector2 = _touches[free[0]]["pos"]
			var b: Vector2 = _touches[free[1]]["pos"]
			var d := a.distance_to(b)
			if _pinch_d > 0.0:
				var k := d / _pinch_d
				if follow:
					follow_dist = clampf(follow_dist / k, 5.0, 600.0)
				else:
					position += -global_basis.z * (d - _pinch_d) * speed * 0.004
			_pinch_d = d
		elif info["moved"]:
			yaw -= sd.relative.x * 0.006
			pitch = clampf(pitch - sd.relative.y * 0.006, -1.5, 1.5)


func _free_touches() -> Array:
	var out := []
	for k in _touches:
		if not _touches[k]["ui"] and k != _grab_touch:
			out.append(k)
	return out


func _update_touches(dt: float) -> void:
	for k in _touches:
		var info: Dictionary = _touches[k]
		info["t"] += dt
		if held == null and _grab_touch < 0 and not info["ui"] and not info["moved"] and info["t"] >= HOLD_TIME and _free_touches().size() == 1:
			_hold_screen = info["pos"]
			_try_grab(info["pos"], true)
			if held:
				_grab_touch = k
				message.emit("Segurando: arraste o dedo para mover, solte para largar")
			else:
				info["moved"] = true  # nada para pegar: vira arrasto de camera


## Toque rapido: seguir a criatura tocada.
func _tap(pos: Vector2) -> void:
	var hit := _mouse_ray(pos, PICK_MASK, 5000.0, true)
	if hit:
		var c: Object = hit.collider
		if c is Area3D and ((c as Area3D).has_meta("fly") or (c as Area3D).has_meta("creature")):
			var n: Node3D = (c as Area3D).get_meta("fly") if (c as Area3D).has_meta("fly") else (c as Area3D).get_meta("creature")
			follow_fly(n)
			message.emit("Seguindo %s" % _label(n))


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		match mb.button_index:
			MOUSE_BUTTON_RIGHT:
				_looking = mb.pressed
				if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED or not mb.pressed:
					pass
			MOUSE_BUTTON_MIDDLE:
				if mb.pressed:
					air_puff()
			MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN:
				if mb.pressed:
					var k := 1.15 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 1.15
					if held:
						hold_dist = clampf(hold_dist * k, 10.0, 2000.0)
					elif follow:
						follow_dist = clampf(follow_dist / k, 5.0, 600.0)
					else:
						speed = clampf(speed * k, 10.0, 5000.0)
						message.emit("Velocidade da camera: %d mm/s" % speed)
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if _looking or Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			yaw -= mm.relative.x * 0.004
			pitch = clampf(pitch - mm.relative.y * 0.004, -1.5, 1.5)
		_update_hover(mm.position)
	elif event.is_action_pressed("toggle_mouse"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else Input.MOUSE_MODE_CAPTURED
	elif event.is_action_pressed("puff"):
		air_puff()
	elif event.is_action_pressed("follow"):
		cycle_follow()
	elif event.is_action_pressed("teleport"):
		teleport_to_fly()
	elif event.is_action_pressed("delete_held"):
		delete_held()
	for i in 7:
		if event.is_action_pressed("spawn_%d" % (i + 1)):
			spawn(i + 1)


# ---------------------------------------------------------------- movimento
func _process(delta: float) -> void:
	var dt := delta / maxf(Engine.time_scale, 0.01)   # camera ignora camera lenta
	var turn := Input.get_axis("turn_right", "turn_left")
	yaw += turn * dt * 1.6
	var mv := Vector3(
		Input.get_axis("move_left", "move_right"),
		Input.get_axis("move_down", "move_up"),
		Input.get_axis("move_forward", "move_back"))
	var mult := 1.0
	if Input.is_action_pressed("fast"):
		mult = 5.0
	elif Input.is_action_pressed("slow"):
		mult = 0.15

	if follow and is_instance_valid(follow):
		_follow_update(dt, mv, mult)
	else:
		follow = null
		basis = Basis.from_euler(Vector3(pitch, yaw, 0.0))
		var target := (basis * Vector3(mv.x, 0.0, mv.z)) + Vector3.UP * mv.y
		if target.length() > 1.0:
			target = target.normalized()
		_vel = _vel.lerp(target * speed * mult, 1.0 - exp(-dt * 8.0))
		var np := position + _vel * dt
		# nao atravessa o chao
		if world:
			var gh := world.height_at(np.x, np.z) + 4.0
			np.y = maxf(np.y, gh)
		position = np
	_update_touches(dt)
	cam_velocity = (global_position - _last_pos) / maxf(dt, 1e-4)
	_last_pos = global_position
	_update_held(dt)


func _follow_update(dt: float, mv: Vector3, mult: float) -> void:
	# em modo seguir: frente/tras = zoom, esq/dir = orbitar, subir/descer = inclinar
	follow_dist = clampf(follow_dist * (1.0 + mv.z * dt * 1.5 * mult), 5.0, 600.0)
	yaw -= mv.x * dt * 1.4
	pitch = clampf(pitch - mv.y * dt * 1.0, -1.45, 0.6)
	var target := follow.global_position + follow.global_basis.y * 1.2
	var b := Basis.from_euler(Vector3(pitch, yaw, 0.0))
	var want := target + b * Vector3(0, 0, follow_dist)
	if world:
		want.y = maxf(want.y, world.height_at(want.x, want.z) + 2.0)
	position = position.lerp(want, 1.0 - exp(-dt * 6.0))
	look_at(target, Vector3.UP)


static func _label(n: Node) -> String:
	if n is Fly:
		return (n as Fly).fly_name
	return n.call("describe") if n.has_method("describe") else str(n.name)


func cycle_follow() -> void:
	var flies := get_tree().get_nodes_in_group("creatures")
	if flies.is_empty():
		return
	if follow == null:
		follow = flies[0]
	else:
		var i := flies.find(follow)
		if i + 1 >= flies.size():
			follow = null
			message.emit("Camera livre")
			return
		follow = flies[i + 1]
	yaw = rotation.y
	pitch = clampf(rotation.x, -1.4, 0.5)
	message.emit("Seguindo %s (roda do mouse = zoom)" % _label(follow))


## Teleporta a camera para perto da mosca (a que voce segue, ou a viva mais
## proxima) e passa a segui-la.
func teleport_to_fly(target: Node3D = null) -> void:
	if target == null:
		if follow is Fly and not (follow as Fly).dead:
			target = follow
		else:
			var best_d := INF
			for n in get_tree().get_nodes_in_group("flies"):
				var f := n as Fly
				if f.dead:
					continue
				var d := f.global_position.distance_to(global_position)
				if d < best_d:
					best_d = d
					target = f
	if target == null:
		message.emit("Nenhuma mosca viva")
		return
	follow = target
	follow_dist = 16.0
	var b := Basis.from_euler(Vector3(pitch, yaw, 0.0))
	position = target.global_position + target.global_basis.y * 1.2 + b * Vector3(0, 0, follow_dist)
	_vel = Vector3.ZERO
	message.emit("Teleportado ate %s" % _label(target))


func follow_fly(f: Node3D) -> void:
	follow = f
	yaw = rotation.y
	pitch = clampf(rotation.x, -1.4, 0.5)


# ---------------------------------------------------------------- manipulacao
func _mouse_ray(screen_pos: Vector2, mask: int, length := 5000.0, force_pos := false) -> Dictionary:
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and not force_pos:
		screen_pos = get_viewport().get_visible_rect().size * 0.5
	var from := project_ray_origin(screen_pos)
	var to := from + project_ray_normal(screen_pos) * length
	var q := PhysicsRayQueryParameters3D.create(from, to, mask)
	q.collide_with_areas = true
	return get_world_3d().direct_space_state.intersect_ray(q)


func _update_hover(screen_pos: Vector2) -> void:
	if held:
		return
	var hit := _mouse_ray(screen_pos, PICK_MASK)
	var text := ""
	if hit:
		var c: Object = hit.collider
		if c is Area3D and (c as Area3D).has_meta("fly"):
			var f: Fly = (c as Area3D).get_meta("fly")
			text = "%s — %s (clique para pegar)" % [f.fly_name, f.behavior]
		elif c is Area3D and (c as Area3D).has_meta("creature"):
			text = "%s (clique para pegar)" % _label((c as Area3D).get_meta("creature"))
		elif c.has_method("describe"):
			text = "%s (clique para pegar)" % c.call("describe")
	if text != _hover_text:
		_hover_text = text
		hover_changed.emit(text)


func _try_grab(screen_pos: Vector2, force_pos := false) -> void:
	var hit := _mouse_ray(screen_pos, PICK_MASK, 5000.0, force_pos)
	if not hit:
		return
	var c: Object = hit.collider
	if c is Area3D and (c as Area3D).has_meta("fly"):
		var f: Fly = (c as Area3D).get_meta("fly")
		held = f
		f.grab()
	elif c is Area3D and (c as Area3D).has_meta("creature"):
		var cr: Node = (c as Area3D).get_meta("creature")
		held = cr
		cr.call("grab")
	elif c is RigidBody3D and (c as Node).is_in_group("grabbable"):
		var rb := c as RigidBody3D
		if rb is Fruit and (rb as Fruit).hanging:
			(rb as Fruit).drop()
		rb.freeze = false
		rb.sleeping = false
		rb.set_meta("held", true)
		held = rb
	else:
		return
	hold_dist = global_position.distance_to(hit.position)
	hover_changed.emit("")


func _hold_point() -> Vector3:
	var sp := _hold_screen
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		sp = get_viewport().get_visible_rect().size * 0.5
	return project_ray_origin(sp) + project_ray_normal(sp) * hold_dist


func _update_held(_dt: float) -> void:
	if held == null:
		return
	if not is_instance_valid(held):
		held = null
		return
	var target := _hold_point()
	if held is Fly or held is Larva or held is Pupa:
		var b := Fly._basis_from(Vector3.UP, (target - global_position).cross(Vector3.UP))
		held.call("carry_to", Transform3D(b, target))
	elif held is RigidBody3D:
		var rb := held as RigidBody3D
		rb.sleeping = false
		var v := (target - rb.global_position) * 14.0
		if v.length() > 6000.0:
			v = v.normalized() * 6000.0
		rb.linear_velocity = v
		rb.angular_velocity *= 0.9


func _release() -> void:
	if held == null:
		return
	if is_instance_valid(held):
		if held is Fly or held is Larva or held is Pupa:
			var n := held as Node3D
			n.call("release", (_hold_point() - n.global_position) * 10.0 + cam_velocity * 0.5)
		elif held is RigidBody3D:
			(held as RigidBody3D).linear_velocity += cam_velocity * 0.3
			(held as RigidBody3D).remove_meta("held")
	held = null


func delete_held() -> void:
	if held and is_instance_valid(held) and not (held is Fly) and not (held is Larva) and not (held is Pupa):
		(held as Node).queue_free()
		message.emit("Objeto removido")
	held = null


## Sopro de ar: empurra objetos e estimula os mecanorreceptores (JO) das moscas.
func air_puff() -> void:
	_puff_fx.restart()
	_puff_fx.emitting = true
	var fwd := -global_basis.z
	for n in get_tree().get_nodes_in_group("grabbable"):
		var rb := n as RigidBody3D
		if rb == null or rb == held:
			continue
		var to := rb.global_position - global_position
		var d := to.length()
		if d > 900.0 or fwd.dot(to / d) < 0.93:
			continue
		if rb is Fruit and (rb as Fruit).hanging and d < 400.0:
			(rb as Fruit).drop()
		rb.freeze = false
		rb.sleeping = false
		rb.apply_central_impulse(to.normalized() * rb.mass * 900.0 * (1.0 - d / 900.0))
	for n in get_tree().get_nodes_in_group("flies"):
		var f := n as Fly
		var to := f.global_position - global_position
		var d := to.length()
		if d < 700.0 and fwd.dot(to / maxf(d, 0.01)) > 0.85:
			f.air_puff(1.2 * (1.0 - d / 700.0) + 0.2)
	message.emit("Fuuu! (sopro)")


func spawn(item: int, use_center := false) -> void:
	if world == null:
		return
	var sp := get_viewport().get_mouse_position()
	if use_center:
		sp = get_viewport().get_visible_rect().size * 0.5
	var hit := _mouse_ray(sp, SPAWN_MASK, 3000.0, use_center)
	var p: Vector3
	if hit:
		p = hit.position + hit.normal * 60.0
	else:
		p = global_position - global_basis.z * 250.0
	match item:
		1: world.spawn_fruit(Fruit.Kind.APPLE, p); message.emit("Maca criada")
		2: world.spawn_fruit(Fruit.Kind.CHERRY, p); message.emit("Cereja criada")
		3: world.spawn_fruit(Fruit.Kind.ORANGE, p); message.emit("Laranja criada")
		4: world.spawn_fruit(Fruit.Kind.LEMON, p); message.emit("Limao (amargo) criado")
		5: world.spawn_pebble(p); message.emit("Pedrinha criada")
		6:
			var main := get_tree().current_scene
			if main.has_method("spawn_fly"):
				var f: Fly = main.call("spawn_fly", hit.position if hit else p)
				message.emit("%s criada" % f.fly_name)
		7:
			var l := Larva.new()
			if LifeManager.instance:
				LifeManager.instance.add_child(l)
			else:
				get_tree().current_scene.add_child(l)
			l.place(hit.position if hit else p, hit.normal if hit else Vector3.UP, hit.collider if hit else null)
			message.emit("Larva criada")
