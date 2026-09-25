class_name GardenWorld
extends Node3D
## Jardim na escala da mosca: 1 unidade = 1 mm. O terreno tem 6 m x 6 m,
## arvores frutiferas de ~1-1.6 m, grama de 2-8 cm e frutas de verdade
## (uma maca tem ~15x o comprimento da mosca).

const SIZE := 6000.0
const RES := 160

## Um dia inteiro dura DAY_LENGTH segundos de jogo (12 min com o tempo x1).
const DAY_LENGTH := 720.0

static var instance: GardenWorld

var noise := FastNoiseLite.new()
var sun: DirectionalLight3D
var moon: DirectionalLight3D
var env: Environment
var sky_mat: ProceduralSkyMaterial
var day := 1
var hour := 7.0               # 0..24
var low_quality := false
var _rng := RandomNumberGenerator.new()
var _sky_t := 0.0


func _ready() -> void:
	instance = self
	_rng.seed = 7
	noise.seed = 11
	noise.frequency = 0.0006
	noise.fractal_octaves = 4
	_environment()
	_terrain()
	_grass()
	_trees()
	_rocks()
	_flowers()
	_fallen_fruits()
	set_quality(low_quality)


func height_at(x: float, z: float) -> float:
	var h := noise.get_noise_2d(x, z) * 140.0
	# clareira plana no centro, onde a mosca comeca
	var d := Vector2(x, z).length()
	var flat := smoothstep(250.0, 900.0, d)
	# borda levanta como um barranco
	var rim := smoothstep(2400.0, 3000.0, d) * 450.0
	return h * flat + rim


func _environment() -> void:
	var we := WorldEnvironment.new()
	env = Environment.new()
	var sky := Sky.new()
	var psm := ProceduralSkyMaterial.new()
	sky_mat = psm
	psm.sky_top_color = Color(0.28, 0.5, 0.85)
	psm.sky_horizon_color = Color(0.7, 0.8, 0.9)
	psm.ground_bottom_color = Color(0.2, 0.17, 0.12)
	psm.ground_horizon_color = Color(0.6, 0.65, 0.6)
	psm.sun_angle_max = 20.0
	sky.sky_material = psm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.7
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.05
	env.ssao_enabled = true
	env.ssao_radius = 2.5
	env.ssao_intensity = 0.8
	env.glow_enabled = true
	env.glow_intensity = 0.4
	env.glow_bloom = 0.05
	env.fog_enabled = true
	env.fog_light_color = Color(0.72, 0.8, 0.88)
	env.fog_density = 0.00012
	env.fog_aerial_perspective = 0.4
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.12
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.name = "Sol"
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.light_energy = 1.25
	sun.light_color = Color(1.0, 0.96, 0.88)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 2500.0
	sun.directional_shadow_split_1 = 0.02
	sun.directional_shadow_split_2 = 0.08
	sun.directional_shadow_split_3 = 0.3
	sun.shadow_bias = 0.03
	sun.shadow_normal_bias = 1.0
	sun.shadow_blur = 1.5
	add_child(sun)
	moon = DirectionalLight3D.new()
	moon.name = "Lua"
	moon.light_color = Color(0.55, 0.65, 1.0)
	moon.light_energy = 0.0
	moon.shadow_enabled = false
	moon.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	moon.rotation_degrees = Vector3(-60, 140, 0)
	add_child(moon)
	low_quality = OS.has_feature("mobile") or OS.has_feature("web")
	set_quality(low_quality)
	_apply_daylight()


# ---------------------------------------------------------------- dia e noite
func _process(dt: float) -> void:
	hour += dt / DAY_LENGTH * 24.0
	if hour >= 24.0:
		hour -= 24.0
		day += 1
	_sky_t += dt
	if _sky_t > 0.2:
		_sky_t = 0.0
		_apply_daylight()





## 1 = sol alto, 0 = noite escura.
func daylight() -> float:
	var elev := sin((hour - 6.0) / 13.0 * PI)   # sol das 6h as 19h
	return smoothstep(-0.08, 0.3, elev)


func is_night() -> bool:
	return daylight() < 0.15


func clock_text() -> String:
	var h := int(hour)
	var m := int((hour - h) * 60.0)
	var fase := "noite"
	if hour >= 5.0 and hour < 7.0:
		fase = "amanhecer"
	elif hour >= 7.0 and hour < 18.0:
		fase = "dia"
	elif hour >= 18.0 and hour < 19.5:
		fase = "entardecer"
	return "Dia %d  %02d:%02d  (%s)" % [day, h, m, fase]


func _apply_daylight() -> void:
	var ang := (hour - 6.0) / 13.0 * PI          # 0 nascer (6h), PI por do sol (19h)
	var elev := sin(ang)
	var dl := daylight()
	var elev_deg := clampf(rad_to_deg(asin(clampf(elev, -1.0, 1.0))) * 0.85, -20.0, 75.0)
	var az := lerpf(100.0, -100.0, clampf(ang / PI, 0.0, 1.0))
	sun.rotation_degrees = Vector3(-maxf(elev_deg, 2.0), az, 0)
	var warm := 1.0 - smoothstep(0.1, 0.5, elev)   # sol baixo = alaranjado
	sun.light_color = Color(1.0, 0.96, 0.88).lerp(Color(1.0, 0.62, 0.35), warm)
	sun.light_energy = 1.25 * dl
	sun.visible = dl > 0.01
	sun.shadow_enabled = dl > 0.05
	moon.light_energy = 0.22 * (1.0 - dl)
	moon.visible = dl < 0.95
	env.ambient_light_energy = lerpf(0.12, 0.7, dl)
	env.background_energy_multiplier = lerpf(0.08, 1.0, dl)
	env.fog_light_color = Color(0.08, 0.1, 0.18).lerp(Color(0.72, 0.8, 0.88), dl)
	if sky_mat:
		sky_mat.sky_top_color = Color(0.02, 0.03, 0.08).lerp(Color(0.28, 0.5, 0.85), dl)
		sky_mat.sky_horizon_color = Color(0.06, 0.07, 0.12).lerp(Color(0.7, 0.8, 0.9), dl).lerp(Color(0.95, 0.6, 0.4), warm * dl)
		sky_mat.ground_horizon_color = Color(0.05, 0.06, 0.06).lerp(Color(0.6, 0.65, 0.6), dl)


## Graficos leves (celular): sem SSAO/brilho, sombras menores, menos grama e
## resolucao 3D reduzida. O cerebro nao muda.
func set_quality(low: bool) -> void:
	low_quality = low
	env.ssao_enabled = not low
	env.glow_enabled = not low
	env.fog_aerial_perspective = 0.0 if low else 0.4
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS if low else DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 1200.0 if low else 2500.0
	sun.shadow_blur = 1.0 if low else 1.5
	var vp := get_viewport()
	if vp:
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
		vp.scaling_3d_scale = 0.7 if low else 1.0
		vp.msaa_3d = Viewport.MSAA_DISABLED if low else Viewport.MSAA_2X
	RenderingServer.directional_shadow_atlas_set_size(2048 if low else 4096, true)
	var grass := get_node_or_null("Grama") as MultiMeshInstance3D
	if grass:
		grass.multimesh.visible_instance_count = grass.multimesh.instance_count / 3 if low else -1
		grass.visibility_range_end = 2000.0 if low else 3500.0


func _terrain() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var step := SIZE / RES
	var half := SIZE * 0.5
	for iz in RES + 1:
		for ix in RES + 1:
			var x := -half + ix * step
			var z := -half + iz * step
			st.set_uv(Vector2(float(ix) / RES, float(iz) / RES))
			st.add_vertex(Vector3(x, height_at(x, z), z))
	for iz in RES:
		for ix in RES:
			var a := iz * (RES + 1) + ix
			var b := a + 1
			var c := a + RES + 1
			var d := c + 1
			st.add_index(a); st.add_index(b); st.add_index(c)
			st.add_index(b); st.add_index(d); st.add_index(c)
	st.generate_normals()
	var mesh := st.commit()
	var mi := MeshInstance3D.new()
	mi.name = "Chao"
	mi.mesh = mesh
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/ground.gdshader")
	mat.set_shader_parameter("noise_big", _noise_tex(3, 0.01, 5))
	mat.set_shader_parameter("noise_fine", _noise_tex(9, 0.04, 3))
	mi.material_override = mat
	add_child(mi)
	var body := StaticBody3D.new()
	body.name = "ChaoColisao"
	body.collision_layer = 1
	# campo de alturas em vez de malha de triangulos: as frutas (esferas)
	# assentam sem tremer. Escala uniforme = tamanho da celula.
	var hm := HeightMapShape3D.new()
	hm.map_width = RES + 1
	hm.map_depth = RES + 1
	var data := PackedFloat32Array()
	data.resize((RES + 1) * (RES + 1))
	for iz in RES + 1:
		for ix in RES + 1:
			data[iz * (RES + 1) + ix] = height_at(-half + ix * step, -half + iz * step) / step
	hm.map_data = data
	var cs := CollisionShape3D.new()
	cs.shape = hm
	cs.scale = Vector3.ONE * step
	body.add_child(cs)
	add_child(body)


func _noise_tex(s: int, freq: float, oct: int) -> NoiseTexture2D:
	var nt := NoiseTexture2D.new()
	var n := FastNoiseLite.new()
	n.seed = s
	n.frequency = freq
	n.fractal_octaves = oct
	nt.noise = n
	nt.seamless = true
	nt.width = 512
	nt.height = 512
	nt.generate_mipmaps = true
	return nt


func _grass() -> void:
	# lamina: tira afunilada de 4 segmentos, altura 1 (escalada por instancia)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var segs := 4
	for i in segs:
		var y0 := float(i) / segs
		var y1 := float(i + 1) / segs
		var w0 := 0.05 * (1.0 - y0)
		var w1 := 0.05 * (1.0 - y1)
		var bend0 := y0 * y0 * 0.25
		var bend1 := y1 * y1 * 0.25
		var v := [Vector3(-w0, y0, bend0), Vector3(w0, y0, bend0), Vector3(w1, y1, bend1), Vector3(-w1, y1, bend1)]
		var uv := [Vector2(0, 1.0 - y0), Vector2(1, 1.0 - y0), Vector2(1, 1.0 - y1), Vector2(0, 1.0 - y1)]
		for idx in [0, 1, 2, 0, 2, 3]:
			st.set_uv(uv[idx])
			st.add_vertex(v[idx])
	st.generate_normals()
	var blade := st.commit()

	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = blade
	var xforms: Array[Transform3D] = []
	var cols: Array[Color] = []
	var patch := FastNoiseLite.new()
	patch.seed = 5
	patch.frequency = 0.0015
	var tries := 0
	while xforms.size() < 60000 and tries < 400000:
		tries += 1
		var r := sqrt(_rng.randf()) * 2600.0
		var a := _rng.randf() * TAU
		var x := cos(a) * r
		var z := sin(a) * r
		var dens := patch.get_noise_2d(x, z) * 0.5 + 0.5
		if r < 220.0 or _rng.randf() > dens * dens * 1.6:
			continue
		var h := _rng.randf_range(25.0, 85.0) * (0.6 + dens)
		var w := _rng.randf_range(30.0, 45.0)
		var b := Basis(Vector3.UP, _rng.randf() * TAU) * Basis(Vector3.RIGHT, _rng.randf_range(-0.25, 0.25))
		b = b.scaled(Vector3(w, h, w))
		xforms.append(Transform3D(b, Vector3(x, height_at(x, z) - 1.0, z)))
		var t := _rng.randf_range(0.8, 1.15)
		cols.append(Color(t, t * _rng.randf_range(0.9, 1.05), t * 0.8))
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
		mm.set_instance_color(i, cols[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Grama"
	mmi.multimesh = mm
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/grass.gdshader")
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.visibility_range_end = 3500.0
	add_child(mmi)


func _trees() -> void:
	var spots := [
		[Vector2(-700, -500), Fruit.Kind.APPLE, 1450.0],
		[Vector2(750, -650), Fruit.Kind.ORANGE, 1300.0],
		[Vector2(-250, 950), Fruit.Kind.CHERRY, 1150.0],
		[Vector2(1350, 500), Fruit.Kind.PEAR, 1250.0],
		[Vector2(-1500, 350), Fruit.Kind.APPLE, 1600.0],
		[Vector2(350, -1600), Fruit.Kind.LEMON, 1000.0],
		[Vector2(1800, -1300), Fruit.Kind.ORANGE, 1400.0],
		[Vector2(-1400, -1600), Fruit.Kind.CHERRY, 1200.0],
	]
	var i := 0
	for s: Array in spots:
		var p: Vector2 = s[0]
		var t := FruitTree.new()
		t.fruit_kind = s[1]
		t.height = s[2]
		t.seed_value = 100 + i
		t.position = Vector3(p.x, height_at(p.x, p.y) - 10.0, p.y)
		t.rotation.y = _rng.randf() * TAU
		t.name = "Arvore_%d" % i
		add_child(t)
		i += 1


func _rock_mesh(r: float, seed_i: int) -> ArrayMesh:
	var sm := SphereMesh.new()
	sm.radius = r
	sm.height = r * 2.0
	sm.radial_segments = 20
	sm.rings = 12
	var arrays := sm.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var n := FastNoiseLite.new()
	n.seed = seed_i
	n.frequency = 1.5 / r
	for k in verts.size():
		var v := verts[k]
		var d := 1.0 + n.get_noise_3dv(v) * 0.35
		verts[k] = Vector3(v.x * d, v.y * d * 0.65, v.z * d)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	for k in idx:
		st.add_vertex(verts[k])
	st.index()
	st.generate_normals()
	return st.commit()


func _rock_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.55, 0.53, 0.5)
	m.albedo_texture = _noise_tex(21, 0.05, 4)
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(0.01, 0.01, 0.01)
	m.roughness = 0.9
	return m


func _rocks() -> void:
	var mat := _rock_material()
	for i in 14:
		var r := _rng.randf_range(60.0, 220.0)
		var a := _rng.randf() * TAU
		var d := _rng.randf_range(500.0, 2300.0)
		var x := cos(a) * d
		var z := sin(a) * d
		var body := StaticBody3D.new()
		body.collision_layer = 1
		var mesh := _rock_mesh(r, i)
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = mat
		body.add_child(mi)
		var cs := CollisionShape3D.new()
		cs.shape = mesh.create_convex_shape()
		body.add_child(cs)
		body.position = Vector3(x, height_at(x, z) - r * 0.2, z)
		body.rotation.y = _rng.randf() * TAU
		add_child(body)
	for i in 10:
		spawn_pebble(Vector3(_rng.randf_range(-600, 600), 0, _rng.randf_range(-600, 600)))


func spawn_pebble(p: Vector3) -> Prop:
	var r := _rng.randf_range(10.0, 30.0)
	var rb := Prop.new()
	rb.radius = r
	rb.collision_layer = 2
	rb.collision_mask = 1 | 2
	rb.mass = pow(r / 10.0, 3) * 0.01
	rb.continuous_cd = true
	rb.add_to_group("grabbable")
	rb.add_to_group("loomer")
	var mesh := _rock_mesh(r, _rng.randi())
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _rock_material()
	rb.add_child(mi)
	var cs := CollisionShape3D.new()
	cs.shape = mesh.create_convex_shape()
	rb.add_child(cs)
	if p.y == 0.0:
		p.y = height_at(p.x, p.z) + r + 5.0
	rb.position = p
	add_child(rb)
	return rb


func _flowers() -> void:
	var petal_cols := [Color(1, 0.85, 0.2), Color(0.95, 0.4, 0.6), Color(1, 1, 1), Color(0.6, 0.5, 1.0)]
	for i in 60:
		var a := _rng.randf() * TAU
		var d := _rng.randf_range(300.0, 2400.0)
		var x := cos(a) * d
		var z := sin(a) * d
		var root := Node3D.new()
		root.position = Vector3(x, height_at(x, z), z)
		var h := _rng.randf_range(80.0, 220.0)
		var stem := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 1.5
		cyl.bottom_radius = 2.5
		cyl.height = h
		stem.mesh = cyl
		var sm := StandardMaterial3D.new()
		sm.albedo_color = Color(0.25, 0.5, 0.15)
		stem.material_override = sm
		stem.position.y = h * 0.5
		root.add_child(stem)
		var col: Color = petal_cols[_rng.randi() % petal_cols.size()]
		var pm := StandardMaterial3D.new()
		pm.albedo_color = col
		pm.roughness = 0.5
		pm.backlight_enabled = true
		pm.backlight = col * 0.4
		pm.cull_mode = BaseMaterial3D.CULL_DISABLED
		var n_p := _rng.randi_range(5, 8)
		var ps := _rng.randf_range(12.0, 22.0)
		for k in n_p:
			var petal := MeshInstance3D.new()
			var pmesh := SphereMesh.new()
			pmesh.radius = ps * 0.5
			pmesh.height = ps * 0.25
			petal.mesh = pmesh
			petal.material_override = pm
			var ang := TAU * k / n_p
			petal.position = Vector3(cos(ang) * ps * 0.55, h, sin(ang) * ps * 0.55)
			petal.scale = Vector3(1.0, 1.0, 0.55)
			petal.rotation = Vector3(0, -ang, 0.25)
			root.add_child(petal)
		var center := MeshInstance3D.new()
		var cm := SphereMesh.new()
		cm.radius = ps * 0.22
		cm.height = ps * 0.3
		center.mesh = cm
		var ccm := StandardMaterial3D.new()
		ccm.albedo_color = Color(0.9, 0.6, 0.1)
		center.material_override = ccm
		center.position.y = h + 1.0
		root.add_child(center)
		add_child(root)


func _fallen_fruits() -> void:
	# algumas frutas ja no chao perto do centro (e fermentando)
	var kinds := [Fruit.Kind.APPLE, Fruit.Kind.APPLE, Fruit.Kind.PEAR, Fruit.Kind.ORANGE, Fruit.Kind.CHERRY, Fruit.Kind.CHERRY, Fruit.Kind.LEMON]
	for i in kinds.size():
		var a := TAU * i / kinds.size() + 0.4
		var d := _rng.randf_range(90.0, 260.0)
		var f := Fruit.create(kinds[i])
		var x := cos(a) * d
		var z := sin(a) * d
		f.position = Vector3(x, height_at(x, z) + float(Fruit.INFO[f.kind]["radius"]) * 1.2 + 2.0, z)
		add_child(f)
		f.ground_time = 40.0 if i != 1 else 5.0
	# e debaixo das arvores
	for c in get_children():
		var t := c as FruitTree
		if t:
			for k in 3:
				var f := Fruit.create(t.fruit_kind)
				var off := Vector2(_rng.randf_range(-300, 300), _rng.randf_range(-300, 300))
				var x := t.position.x + off.x
				var z := t.position.z + off.y
				f.position = Vector3(x, height_at(x, z) + float(Fruit.INFO[f.kind]["radius"]) * 1.2 + 2.0, z)
				add_child(f)
				f.ground_time = _rng.randf_range(0.0, 80.0)


## Fruta que apodreceu por completo: vira uma mancha de terra escura
## (materia organica) que se mistura ao chao e some em ~2 dias.
func compost(pos: Vector3, radius: float) -> void:
	var mi := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = radius * 0.9
	cyl.bottom_radius = radius * 1.05
	cyl.height = radius * 0.08
	cyl.radial_segments = 16
	mi.mesh = cyl
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.2, 0.13, 0.07, 0.95)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.9
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var y := height_at(pos.x, pos.z)
	mi.global_position = Vector3(pos.x, y + radius * 0.02, pos.z)
	var tw := mi.create_tween()
	tw.tween_property(m, "albedo_color:a", 0.0, DAY_LENGTH * 2.0)
	tw.tween_callback(mi.queue_free)


func spawn_fruit(kind: Fruit.Kind, p: Vector3) -> Fruit:
	var f := Fruit.create(kind)
	f.position = p
	add_child(f)
	return f
