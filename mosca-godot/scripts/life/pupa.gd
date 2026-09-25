class_name Pupa
extends Node3D
## Pupario (casulo) com a metamorfose visivel por dentro.
##
## Como na Drosophila (~4 dias a 25 °C):
##   pre-pupa     a cuticula da larva endurece e escurece (tanning)
##   histolise    os tecidos da larva sao dissolvidos (a larva some aos poucos)
##   discos       os discos imaginais (olhos, pernas, asas, halteres) crescem
##                e formam o corpo da mosca
##   pupa farata  o adulto ja formado: olhos ficam vermelhos, a cuticula e as
##                asas escurecem; no fim a mosca sai pela tampa (operculo)
## O casulo e semitransparente para dar para ver o que acontece dentro.
## Pode ser segurado e carregado; se a larva pupou enterrada, fica na terra.

const WORLD_MASK := 1 | 2

var genome: Genome
var memory := PackedFloat32Array()
var generation := 1
var lineage := 0
var uid := 0
var mind: CreatureMemory
var wiring: Array = []
var parents: Array = []
var size_mm := 3.0
var buried := false
var surface: Node3D
var dead := false
var behavior := "pre-pupa"
var _local := Transform3D.IDENTITY
var _t := 0.0
var _vis_t := 0.0
var _carried := false
var _carry_t := Transform3D.IDENTITY
var _root: Node3D
var _shell: MeshInstance3D
var _shell_mat: StandardMaterial3D
var _larva: Array[MeshInstance3D] = []
var _larva_mat: StandardMaterial3D
var _discs: Array[MeshInstance3D] = []
var _disc_mat: StandardMaterial3D
var _fly: FlyBody
var _fly_mats: Array = []        # [material, cor final, tipo 0 corpo / 1 olho / 2 asa]
var _mound: MeshInstance3D
var _len := 3.0
var _rad := 0.6


func _ready() -> void:
	add_to_group("pupae")
	add_to_group("creatures")
	if genome == null:
		genome = Genome.random_founder(RandomNumberGenerator.new())
	_build()
	var area := Area3D.new()
	area.collision_layer = 4
	area.collision_mask = 0
	area.monitoring = false
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = maxf(2.5, size_mm * 0.7)
	cs.shape = sh
	area.add_child(cs)
	area.set_meta("creature", self)
	add_child(area)
	_update_visuals()


## Prende na superficie onde esta (fruta, pedra) para acompanhar se ela mexer.
func attach(surf: Node3D) -> void:
	surface = surf if is_instance_valid(surf) and (surf is RigidBody3D) else null
	if surface:
		_local = surface.global_transform.affine_inverse() * global_transform


# ---------------------------------------------------------------- modelo
func _build() -> void:
	_len = size_mm * 0.92
	_rad = size_mm * 0.19
	_root = Node3D.new()
	_root.position.y = _rad * 0.9 - (_rad * 1.25 if buried else 0.0)
	add_child(_root)
	# pupario: barril segmentado, ventre achatado
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 30
	var segs := 20
	for i in rings + 1:
		var t := float(i) / rings
		var z := (t - 0.5) * _len
		var r := _rad * pow(sin(PI * clampf(t, 0.001, 0.999)), 0.45) * (1.0 + 0.035 * cos(t * TAU * 11.0))
		for j in segs + 1:
			var a := TAU * float(j) / segs
			var y := sin(a) * r
			if y < 0.0:
				y *= 0.8
			st.set_uv(Vector2(float(j) / segs, t))
			st.add_vertex(Vector3(cos(a) * r, y, z))
	for i in rings:
		for j in segs:
			var a := i * (segs + 1) + j
			var b := a + segs + 1
			for idx in [a, b, a + 1, a + 1, b, b + 1]:
				st.add_index(idx)
	st.generate_normals()
	_shell = MeshInstance3D.new()
	_shell.mesh = st.commit()
	_shell_mat = StandardMaterial3D.new()
	_shell_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_shell_mat.roughness = 0.3
	_shell_mat.rim_enabled = true
	_shell_mat.rim = 0.4
	_shell_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_shell_mat.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
	_shell.material_override = _shell_mat
	_root.add_child(_shell)
	# espiraculos anteriores (os "chifrinhos" do pupario)
	var sp_mat := StandardMaterial3D.new()
	sp_mat.albedo_color = Color(0.25, 0.15, 0.08)
	for s in [-1, 1]:
		var horn := MeshInstance3D.new()
		var c := CylinderMesh.new()
		c.top_radius = size_mm * 0.012
		c.bottom_radius = size_mm * 0.025
		c.height = size_mm * 0.14
		horn.mesh = c
		horn.material_override = sp_mat
		horn.position = Vector3(_rad * 0.35 * s, _rad * 0.75, -_len * 0.42)
		horn.rotation = Vector3(-0.9, 0.0, -0.35 * s)
		_root.add_child(horn)
	# a larva la dentro (vai sendo dissolvida)
	_larva_mat = StandardMaterial3D.new()
	_larva_mat.albedo_color = Color(0.97, 0.95, 0.86)
	_larva_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_larva_mat.roughness = 0.35
	var sph := SphereMesh.new()
	sph.radius = 0.5
	sph.height = 1.0
	sph.radial_segments = 12
	sph.rings = 6
	for i in 9:
		var mi := MeshInstance3D.new()
		mi.mesh = sph
		mi.material_override = _larva_mat
		_root.add_child(mi)
		_larva.append(mi)
	# discos imaginais: olhos-antenas, 6 pernas, 2 asas, 2 halteres
	_disc_mat = StandardMaterial3D.new()
	_disc_mat.albedo_color = Color(1.0, 1.0, 0.97)
	_disc_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_disc_mat.emission_enabled = true
	_disc_mat.emission = Color(0.3, 0.3, 0.28)
	var disc_pos := [Vector3(-0.35, 0.2, -0.35), Vector3(0.35, 0.2, -0.35)]
	for k in 3:
		for s in [-1, 1]:
			disc_pos.append(Vector3(0.45 * s, -0.45, -0.12 + k * 0.12))
	for s in [-1, 1]:
		disc_pos.append(Vector3(0.55 * s, 0.4, 0.02))
		disc_pos.append(Vector3(0.5 * s, 0.35, 0.16))
	for dp: Vector3 in disc_pos:
		var mi := MeshInstance3D.new()
		mi.mesh = sph
		mi.material_override = _disc_mat
		mi.position = Vector3(dp.x * _rad, dp.y * _rad, dp.z * _len)
		mi.scale = Vector3.ZERO
		_root.add_child(mi)
		_discs.append(mi)
	# a mosca que vai se formar (NeuroMechFly), pernas e asas dobradas
	_fly = FlyBody.new()
	_fly.visible = false
	_root.add_child(_fly)
	for leg: String in FlyCPG.LEGS:
		_fly.set_joint(leg + "_coxa", 0.0, deg_to_rad(20.0), 0.0)
		_fly.set_joint(leg + "_trochanterfemur", 0.0, deg_to_rad(-165.0), 0.0)
		_fly.set_joint(leg + "_tibia", 0.0, deg_to_rad(160.0), 0.0)
	_fly.set_joint("c_rostrum", 0.0, 0.0, 0.0)
	_fly.apply_pose()
	# asas ainda nao expandidas (so abrem depois que a mosca sai)
	for w in ["l_wing", "r_wing"]:
		if _fly.segments.has(w):
			(_fly.segments[w] as Node3D).get_node("mesh").scale = Vector3.ONE * 0.42
	var hue := genome.get_gene("hue")
	for seg_name: String in _fly.segments:
		var mi: MeshInstance3D = (_fly.segments[seg_name] as Node3D).get_node("mesh")
		var base := mi.material_override as StandardMaterial3D
		if base == null:
			continue
		var m := base.duplicate() as StandardMaterial3D
		var kind := 1 if seg_name.ends_with("_eye") else (2 if seg_name.ends_with("_wing") else 0)
		var final_c := m.albedo_color
		var tex := m.albedo_texture
		if kind == 0 and tex:
			# mesma cor da mosca adulta (ver Fly._apply_genome_visuals)
			final_c = Color.from_hsv(fposmod(hue, 1.0), 0.0, 1.0).lerp(Color.from_hsv(fposmod(0.08 + hue, 1.0), 0.35, 1.0), 0.5)
		elif kind == 0 and final_c.s > 0.01:
			final_c = Color.from_hsv(fposmod(final_c.h + hue, 1.0), final_c.s, final_c.v, final_c.a)
		mi.material_override = m
		_fly_mats.append([m, final_c, kind, tex])
	if buried:
		_make_mound()


func _make_mound() -> void:
	_mound = MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 1.0
	sm.height = 0.5
	sm.radial_segments = 12
	sm.rings = 4
	_mound.mesh = sm
	var mm := StandardMaterial3D.new()
	mm.albedo_color = Color(0.3, 0.22, 0.14)
	mm.roughness = 1.0
	_mound.material_override = mm
	_mound.scale = Vector3(_rad * 2.6, _rad * 1.1, _len * 0.75)
	add_child(_mound)


# ---------------------------------------------------------------- tempo
func _physics_process(dt: float) -> void:
	if dead:
		return
	_t += dt
	if _carried:
		global_transform = global_transform.interpolate_with(_carry_t, 1.0 - exp(-dt * 20.0))
	elif is_instance_valid(surface):
		global_transform = surface.global_transform * _local
	elif surface != null:
		surface = null
		_fall_to_ground()
	if not buried and not _carried and Engine.get_physics_frames() > 180:
		Hazards.refresh(get_tree())
		var r := Hazards.check(global_position, _rad * 1.8, _len * 0.4, surface)
		if r.has("crush"):
			_crush(r["crush"])
			return
	_vis_t -= dt
	if _vis_t <= 0.0:
		_vis_t = 0.5
		_update_visuals()
	if _t >= LifeManager.PUPA_TIME:
		_eclose()


func phase() -> float:
	return clampf(_t / LifeManager.PUPA_TIME, 0.0, 1.0)


func _update_visuals() -> void:
	var ph := phase()
	# casulo: branco-creme -> ambar -> marrom; fica mais claro no fim (a mosca
	# escura aparece por dentro, como numa pupa de verdade)
	var tan := smoothstep(0.0, 0.1, ph)
	var col := Color(0.96, 0.93, 0.8).lerp(Color(0.75, 0.48, 0.2), tan).lerp(Color(0.5, 0.28, 0.11), smoothstep(0.08, 0.25, ph))
	col.a = lerpf(0.6, 0.5, tan) - 0.1 * smoothstep(0.8, 1.0, ph)
	_shell_mat.albedo_color = col
	# larva: contrai na pre-pupa e depois e dissolvida (histolise)
	var contract := lerpf(1.0, 0.85, smoothstep(0.0, 0.1, ph))
	var k := 1.0 - smoothstep(0.1, 0.36, ph)
	var n := _larva.size()
	for i in n:
		var t := float(i) / (n - 1)
		var mi := _larva[i]
		mi.visible = k > 0.02
		var wob := 1.0 + 0.25 * sin(float(i) * 2.3 + _t * 0.05) * (1.0 - k)
		var r := _rad * 0.85 * sin(PI * lerpf(0.12, 0.88, t)) * wob
		mi.position = Vector3(0.0, -_rad * 0.05, (t - 0.5) * _len * 0.8 * contract)
		mi.scale = Vector3(r * 2.0, r * 1.8, _len / n * 1.6) * lerpf(0.25, 1.0, k)
	_larva_mat.albedo_color = Color(0.97, 0.95, 0.86).lerp(Color(0.9, 0.82, 0.45), 1.0 - k)
	_larva_mat.albedo_color.a = lerpf(0.0, 0.95, k)
	# discos imaginais crescem e se fundem no corpo novo
	var grow := smoothstep(0.12, 0.45, ph)
	var fuse := 1.0 - smoothstep(0.45, 0.6, ph)
	for d in _discs:
		d.visible = grow * fuse > 0.01
		d.scale = Vector3.ONE * _rad * 0.5 * grow
	_disc_mat.albedo_color.a = fuse * 0.9
	# o adulto: aparece palido, cresce ate ocupar o casulo e ganha cor
	var form := smoothstep(0.3, 0.6, ph)
	_fly.visible = form > 0.01
	# o adulto dobrado cabe apertado no casulo
	var fs := minf(_len / 3.4, _rad / 0.62) * lerpf(0.45, 1.0, form)
	_fly.scale = Vector3.ONE * fs
	_fly.position = Vector3(0.0, -_fly.body_height * fs * 0.95, _len * 0.03)
	var eye := smoothstep(0.55, 0.72, ph)
	var cut := smoothstep(0.75, 0.92, ph)
	var wing := smoothstep(0.85, 0.97, ph)
	var pale := Color(1.0, 1.0, 0.96)
	for item: Array in _fly_mats:
		var m: StandardMaterial3D = item[0]
		var fc: Color = item[1]
		var a := fc.a
		match int(item[2]):
			1:
				var c := pale.lerp(Color(0.95, 0.85, 0.3), clampf(eye * 2.0, 0.0, 1.0)).lerp(fc, clampf(eye * 2.0 - 1.0, 0.0, 1.0))
				m.albedo_color = Color(c.r, c.g, c.b, a)
			2:
				var c := Color(0.95, 0.95, 0.95).lerp(fc, wing)
				m.albedo_color = Color(c.r, c.g, c.b, a)
			_:
				# palida (sem pigmento) -> cuticula pigmentada com a textura
				var tex: Texture2D = item[3]
				if tex and cut >= 0.5:
					m.albedo_texture = tex
					var c := Color(1.0, 1.0, 1.0).lerp(fc, (cut - 0.5) * 2.0)
					m.albedo_color = Color(c.r, c.g, c.b, a)
				else:
					m.albedo_texture = null
					var target := Color(0.62, 0.45, 0.28) if tex else fc
					var c := pale.lerp(target, cut * (2.0 if tex else 1.0))
					m.albedo_color = Color(c.r, c.g, c.b, a)
	if ph < 0.1:
		behavior = "pre-pupa: a pele da larva endurece e escurece"
	elif ph < 0.36:
		behavior = "pupa: a larva esta sendo dissolvida (histolise)"
	elif ph < 0.55:
		behavior = "pupa: discos imaginais formando o corpo da mosca"
	elif ph < 0.72:
		behavior = "pupa farata: olhos ficando vermelhos"
	elif ph < 0.92:
		behavior = "pupa farata: cuticula escurecendo"
	else:
		behavior = "pupa farata: asas prontas, quase nascendo"
	# no fim a mosca ja se mexe la dentro
	if ph > 0.9 and _fly.visible:
		var w := sin(_t * 3.0) * 0.08
		for leg: String in ["lf", "rf"]:
			_fly.set_joint(leg + "_tibia", 0.0, deg_to_rad(160.0) + w, 0.0)
		_fly.apply_pose()


func _eclose() -> void:
	if dead:
		return
	dead = true
	# o pupario vazio fica para tras, aberto na frente (operculo)
	var shell := MeshInstance3D.new()
	shell.mesh = _shell.mesh
	var m := _shell_mat.duplicate() as StandardMaterial3D
	m.albedo_color = Color(0.55, 0.33, 0.14, 0.75)
	shell.material_override = m
	shell.name = "PuparioVazio"
	get_parent().add_child(shell)
	shell.global_transform = _root.global_transform
	get_tree().create_timer(LifeManager.DAY, false).timeout.connect(shell.queue_free)
	if LifeManager.instance:
		LifeManager.instance.eclose(self)
	queue_free()


func _crush(obj: Object) -> void:
	dead = true
	behavior = "esmagada"
	_root.scale = Vector3(1.3, 0.3, 1.1)
	_shell_mat.albedo_color = Color(0.4, 0.3, 0.15, 0.9)
	if LifeManager.instance:
		LifeManager.instance.report_death(self, "esmagada (pupa)", obj)
		LifeManager.instance.splat(global_position, global_basis.y)
	get_tree().create_timer(LifeManager.DAY * 0.5, false).timeout.connect(queue_free)


# ---------------------------------------------------------------- manipulacao
func grab() -> void:
	if dead:
		return
	_carried = true
	surface = null
	if buried:
		# o jogador desenterra a pupa
		buried = false
		_root.position.y = _rad * 0.9
		if _mound:
			_mound.queue_free()
			_mound = null
			if LifeManager.instance:
				LifeManager.instance.make_hole(global_position, global_basis.y, size_mm * 1.2)


func carry_to(t: Transform3D) -> void:
	_carry_t = t


func release(_vel: Vector3) -> void:
	_carried = false
	_fall_to_ground()


func _fall_to_ground() -> void:
	var q := PhysicsRayQueryParameters3D.create(global_position + Vector3.UP * 2.0, global_position + Vector3.DOWN * 3000.0, WORLD_MASK)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit:
		global_transform = Transform3D(Fly._basis_from(hit.normal, -global_basis.z), hit.position)
		attach(hit.collider)


func describe() -> String:
	var left := maxf(0.0, LifeManager.PUPA_TIME - _t) / LifeManager.DAY
	return "Pupa (geracao %d%s) — %s — mosca em %.1f dia(s)" % [generation, ", enterrada" if buried else "", behavior, left]


func loom_radius() -> float:
	return size_mm * 0.5
