class_name SaveGame
extends RefCounted
## Salvar / carregar o progresso.
##
##   user://mundo/mundo.json               relogio, estatisticas, frutas, ovos, pupas, camera
##   user://mundo/individuos/<id>.json     UM arquivo por mosca/larva viva
##   user://mundo/arquivo/<id>.json        individuos que ja morreram (historico)
##
## O arquivo de cada individuo guarda o conectoma UNICO dele: o conectoma
## base da especie (brain/full/*.bin.gz, que ja vem no jogo) + as sementes da
## fiacao individual herdadas dos pais + a amplitude dessa variacao (gene) +
## os pesos das sinapses plasticas KC->MBON que ele aprendeu na vida.
## Junto vao os genes, a memoria (cheiros, perigos, medo) e o estado do corpo.

const DIR := "user://mundo"
const VERSION := 2


static func exists() -> bool:
	return FileAccess.file_exists(DIR + "/mundo.json")


static func folder_path() -> String:
	return ProjectSettings.globalize_path(DIR)


# ---------------------------------------------------------------- salvar
static func save(main: Node) -> String:
	DirAccess.make_dir_recursive_absolute(DIR + "/individuos")
	DirAccess.make_dir_recursive_absolute(DIR + "/arquivo")
	var tree := main.get_tree()
	var lm := LifeManager.instance
	var gw := GardenWorld.instance
	var cam: Spectator = main.get("spectator")
	var w := {
		"versao": VERSION,
		"salvo_em": Time.get_datetime_string_from_system(),
		"dia": gw.day, "hora": gw.hour,
		"vida": {"nascimentos": lm.births, "mortes": lm.deaths, "geracao_max": lm.max_generation,
			"uid": lm.uid_counter, "moscas_criadas": lm.fly_count, "linhagens": lm.lineages},
		"camera": {"pos": _v(cam.global_position), "yaw": cam.yaw, "pitch": cam.pitch},
		"graficos_leves": gw.low_quality,
		"frutas": [], "pedras": [], "ovos": [], "pupas": [], "individuos": [], "arvores": [],
	}
	for t in gw.get_children():
		if t is FruitTree:
			w["arvores"].append({"penduradas": (t as FruitTree).save_hanging()})
	for n in tree.get_nodes_in_group("grabbable"):
		if n is Fruit and not (n as Fruit).hanging and not n.is_queued_for_deletion():
			var f := n as Fruit
			var hs: Array = []
			for h: Array in f.holes:
				hs.append([_v(h[0]), _v(h[1]), h[2]])
			w["frutas"].append({"tipo": int(f.kind), "pos": _v(f.global_position), "rot": _q(f.global_basis.get_rotation_quaternion()),
				"raio": f.radius, "polpa": f.flesh, "fermentando": f.ground_time, "furos": hs})
		elif n is Prop:
			w["pedras"].append({"pos": _v((n as Prop).global_position)})
	for e: Egg in tree.get_nodes_in_group("eggs"):
		w["ovos"].append({"id": e.uid, "genes": e.genome.to_dict(), "memoria_sinapses": _pack(e.memory), "memoria": _mind(e.mind),
			"fiacao": e.wiring, "pais": e.parents, "geracao": e.generation, "linhagem": e.lineage, "t": e.get("_t"),
			"pos": _v(e.global_position), "normal": _v(e.global_basis.y)})
	for p: Pupa in tree.get_nodes_in_group("pupae"):
		w["pupas"].append({"id": p.uid, "genes": p.genome.to_dict(), "memoria_sinapses": _pack(p.memory), "memoria": _mind(p.mind),
			"fiacao": p.wiring, "pais": p.parents, "geracao": p.generation, "linhagem": p.lineage, "t": p.get("_t"),
			"tamanho": p.size_mm, "enterrada": p.buried, "pos": _v(p.global_position), "normal": _v(p.global_basis.y)})
	# um arquivo por individuo vivo; apaga os que nao existem mais
	var alive := {}
	for c in tree.get_nodes_in_group("creatures"):
		if (c is Fly and not (c as Fly).dead) or (c is Larva and not (c as Larva).dead):
			var d := individual(c)
			alive[str(d["id"])] = true
			_write(DIR + "/individuos/%d.json" % int(d["id"]), d)
			w["individuos"].append(int(d["id"]))
	var da := DirAccess.open(DIR + "/individuos")
	if da:
		for fn in da.get_files():
			if fn.ends_with(".json") and not alive.has(fn.get_basename()):
				da.remove(fn)
	_write(DIR + "/mundo.json", w)
	return "Progresso salvo: %d individuos, %d frutas (%s)" % [alive.size(), w["frutas"].size(), folder_path()]


## Dicionario completo de um individuo (mosca ou larva).
static func individual(c: Node) -> Dictionary:
	var brain = c.get("brain")
	var genome: Genome = c.get("genome")
	var wiring: Array = c.get("wiring")
	var syn := PackedFloat32Array()
	if brain:
		syn = brain.get_memory()
	var changed := 0
	for x in syn:
		if absf(x - 1.0) > 0.01:
			changed += 1
	var d := {
		"id": c.get("uid"),
		"especie": "mosca adulta" if c is Fly else "larva",
		"geracao": c.get("generation"), "linhagem": c.get("lineage"), "pais": c.get("parents"),
		"idade_s": c.get("age"), "energia": c.get("energy"), "papo": c.get("gut"), "saude": c.get("health"),
		"pos": _v((c as Node3D).global_position), "yaw": (c as Node3D).global_rotation.y,
		"genes": genome.to_dict(),
		"conectoma": {
			"base": "brain/full/%s.bin.gz" % ("mcns" if c is Fly else "larva"),
			"nome": str(brain.name) if brain else "",
			"neuronios": brain.n if brain else 0,
			"sinapses": brain.total_edges if brain else 0,
			"sementes_fiacao": {"haplotipo_mae": wiring[0], "haplotipo_pai": wiring[1], "mutacao": wiring[2]},
			"variacao_pesos": genome.get_gene("wiring_var"),
			"sinapses_plasticas": syn.size(),
			"sinapses_plasticas_alteradas": changed,
			"pesos_plasticos": _pack(syn),
			"como_reconstruir": "peso(k) = w_base(k) * max(0, 1 + variacao * (g(k) + 0.3*m(k))), g da semente da mae ou do pai (sorteio por sinapse com a semente propria), m da semente propria; KC->MBON = w_base * pesos_plasticos",
		},
		"memoria": _mind(c.get("mind")),
	}
	if c is Fly:
		var f := c as Fly
		d["nome"] = f.fly_name
		d["sexo"] = f.sex
		d["fecundada"] = f.mated
		d["ovos_para_botar"] = f.eggs_to_lay
		d["ovos_postos"] = f.eggs_laid
		if f.mated and f.sperm_genome:
			d["esperma"] = {"id": f.sperm_uid, "genes": f.sperm_genome.to_dict(), "geracao": f.sperm_generation,
				"fiacao": f.sperm_wiring, "memoria": _mind(f.sperm_mind), "memoria_sinapses": _pack(f.sperm_memory)}
	else:
		var l := c as Larva
		d["comida"] = l.food
		d["tamanho_mm"] = l.size_mm
		d["estagio"] = l.instar
		d["tempo_no_estagio_s"] = l.instar_t
		d["comida_no_estagio"] = l.instar_food
		d["memoria_herdada"] = _pack(l.memory)
	return d


static func archive_individual(c: Node, reason: String) -> void:
	if not (c is Fly or c is Larva):
		return
	DirAccess.make_dir_recursive_absolute(DIR + "/arquivo")
	var d := individual(c)
	d["morte"] = reason
	if GardenWorld.instance:
		d["morreu_em"] = GardenWorld.instance.clock_text()
	_write(DIR + "/arquivo/%d.json" % int(d["id"]), d)
	var live := DIR + "/individuos/%d.json" % int(d["id"])
	if FileAccess.file_exists(live):
		DirAccess.remove_absolute(live)


## Copia a pasta do save para um lugar que o usuario consegue abrir (no
## Android a pasta user:// fica em /data/data/..., inacessivel sem root).
## Tenta Documentos, depois Downloads, depois a pasta do projeto.
static func export_copy() -> String:
	var dirs: Array[String] = []
	for sd in [OS.SYSTEM_DIR_DOCUMENTS, OS.SYSTEM_DIR_DOWNLOADS]:
		var d := OS.get_system_dir(sd)
		if d != "":
			dirs.append(d.path_join(str(ProjectSettings.get_setting("application/config/name"))))
	dirs.append(ProjectSettings.globalize_path("res://save_exportado"))
	for dest in dirs:
		var n := _copy_tree(DIR, dest.path_join("mundo"))
		if n > 0:
			return "Copiados %d arquivos para: %s" % [n, dest.path_join("mundo")]
	return "Nao consegui copiar (sem permissao de escrita). Pasta original: " + folder_path()


static func _copy_tree(src: String, dst: String) -> int:
	if DirAccess.make_dir_recursive_absolute(dst) != OK and not DirAccess.dir_exists_absolute(dst):
		return 0
	var da := DirAccess.open(src)
	if da == null:
		return 0
	var n := 0
	for f in da.get_files():
		var data := FileAccess.get_file_as_bytes(src.path_join(f))
		var out := FileAccess.open(dst.path_join(f), FileAccess.WRITE)
		if out == null:
			return 0
		out.store_buffer(data)
		out.close()
		n += 1
	for sub in da.get_directories():
		n += _copy_tree(src.path_join(sub), dst.path_join(sub))
	return n


# ---------------------------------------------------------------- carregar
static func load_world(main: Node) -> bool:
	var w: Variant = _read(DIR + "/mundo.json")
	if not (w is Dictionary):
		return false
	var tree := main.get_tree()
	var lm := LifeManager.instance
	var gw := GardenWorld.instance
	gw.day = int(w.get("dia", 1))
	gw.hour = float(w.get("hora", 7.0))
	var v: Dictionary = w.get("vida", {})
	lm.births = int(v.get("nascimentos", 0))
	lm.deaths = v.get("mortes", {})
	lm.max_generation = int(v.get("geracao_max", 1))
	lm.uid_counter = int(v.get("uid", 0))
	lm.fly_count = int(v.get("moscas_criadas", 0))
	lm.lineages = int(v.get("linhagens", 0))
	gw.set_quality(bool(w.get("graficos_leves", gw.low_quality)))
	# frutas penduradas salvas (sem isso cada carregamento enchia as arvores
	# de novo e as frutas caidas se acumulavam)
	var trees: Array = []
	for t in gw.get_children():
		if t is FruitTree:
			trees.append(t)
	var saved_trees: Array = w.get("arvores", [])
	for i in mini(trees.size(), saved_trees.size()):
		(trees[i] as FruitTree).load_hanging((saved_trees[i] as Dictionary).get("penduradas", []))
	# o mundo salvo substitui as frutas caidas e pedras iniciais
	for n in tree.get_nodes_in_group("grabbable"):
		if (n is Fruit and not (n as Fruit).hanging) or n is Prop:
			n.get_parent().remove_child(n)
			n.queue_free()
	for fd: Dictionary in w.get("frutas", []):
		var f := Fruit.create(int(fd["tipo"]) as Fruit.Kind)
		f.radius_override = float(fd.get("raio", 0.0))
		f.position = _vec(fd["pos"])
		f.quaternion = _quat(fd.get("rot", [0, 0, 0, 1]))
		gw.add_child(f)
		f.ground_time = float(fd.get("fermentando", 0.0))
		f.flesh = float(fd.get("polpa", 1.0))
		f.consume(0.0)
		for h: Array in fd.get("furos", []):
			f.holes.append([_vec(h[0]), _vec(h[1]), float(h[2])])
			f.call("_make_hole_mesh", _vec(h[0]), _vec(h[1]), float(h[2]))
	for pd: Dictionary in w.get("pedras", []):
		gw.spawn_pebble(_vec(pd["pos"]))
	for ed: Dictionary in w.get("ovos", []):
		var e := Egg.new()
		_fill_stage(e, ed)
		lm.add_child(e)
		e.set("_t", float(ed.get("t", 0.0)))
		var pos := _vec(ed["pos"])
		e.place(pos, _vec(ed.get("normal", [0, 1, 0])), _fruit_at(tree, pos))
	for pd: Dictionary in w.get("pupas", []):
		var p := Pupa.new()
		_fill_stage(p, pd)
		p.size_mm = float(pd.get("tamanho", 3.0))
		p.buried = bool(pd.get("enterrada", false))
		p.set("_t", float(pd.get("t", 0.0)))
		lm.add_child(p)
		p.global_transform = Transform3D(Fly._basis_from(_vec(pd.get("normal", [0, 1, 0])), Vector3.FORWARD), _vec(pd["pos"]))
		p.attach(_fruit_at(tree, p.global_position))
	var n_ind := 0
	for id in w.get("individuos", []):
		var d: Variant = _read(DIR + "/individuos/%d.json" % int(id))
		if d is Dictionary:
			_spawn_individual(main, d)
			n_ind += 1
	var c: Dictionary = w.get("camera", {})
	var cam: Spectator = main.get("spectator")
	if cam and c.has("pos"):
		cam.global_position = _vec(c["pos"])
		cam.yaw = float(c.get("yaw", 0.0))
		cam.pitch = float(c.get("pitch", -0.35))
	if Hud.instance:
		Hud.instance.toast("Mundo carregado: %s, %d individuos" % [gw.clock_text(), n_ind])
	return true


static func _spawn_individual(main: Node, d: Dictionary) -> void:
	var genome := Genome.from_dict(d.get("genes", {}))
	var con: Dictionary = d.get("conectoma", {})
	var seeds: Dictionary = con.get("sementes_fiacao", {})
	var wiring := [int(seeds.get("haplotipo_mae", randi())), int(seeds.get("haplotipo_pai", randi())), int(seeds.get("mutacao", randi()))]
	var mind := CreatureMemory.from_dict(d.get("memoria", {}))
	var syn := _unpack(str(con.get("pesos_plasticos", "")))
	var pos := _vec(d.get("pos", [0, 0, 0]))
	if str(d.get("especie", "")) == "larva":
		var l := Larva.new()
		l.genome = genome
		l.uid = int(d["id"])
		l.wiring = wiring
		l.mind = mind
		l.parents = d.get("pais", [])
		l.generation = int(d.get("geracao", 1))
		l.lineage = int(d.get("linhagem", 0))
		l.age = float(d.get("idade_s", 0.0))
		l.energy = float(d.get("energia", 0.5))
		l.gut = float(d.get("papo", 0.0))
		l.health = float(d.get("saude", 1.0))
		l.food = float(d.get("comida", 0.0))
		if d.has("estagio"):
			l.instar = int(d["estagio"])
			l.instar_t = float(d.get("tempo_no_estagio_s", 0.0))
			l.instar_food = float(d.get("comida_no_estagio", 0.0))
		else:
			# save antigo: estima o estagio pela comida que ja comeu
			l.instar = 1 if l.food < 0.1 else (2 if l.food < 0.35 else 3)
			l.instar_food = clampf(l.food - [0.0, 0.1, 0.35][l.instar - 1], 0.0, 1.0)
		l.memory = _unpack(str(d.get("memoria_herdada", "")))
		LifeManager.instance.add_child(l)
		if l.brain and not syn.is_empty():
			l.brain.set_memory(syn)
		var hit := _ray(main, pos + Vector3.UP * 20.0, pos + Vector3.DOWN * 200.0)
		l.place(hit.position if hit else pos, hit.normal if hit else Vector3.UP, hit.collider if hit else null)
		return
	var extra := {"uid": int(d["id"]), "wiring": wiring, "mind": mind, "parents": d.get("pais", []),
		"fly_name": str(d.get("nome", "Mosca")), "age": float(d.get("idade_s", 0.0)), "energy": float(d.get("energia", 0.7)),
		"gut": float(d.get("papo", 0.0)), "health": float(d.get("saude", 1.0)), "mated": bool(d.get("fecundada", false)),
		"eggs_to_lay": int(d.get("ovos_para_botar", 0)), "eggs_laid": int(d.get("ovos_postos", 0))}
	var sp: Dictionary = d.get("esperma", {})
	if not sp.is_empty():
		extra["sperm_genome"] = Genome.from_dict(sp.get("genes", {}))
		extra["sperm_uid"] = int(sp.get("id", 0))
		extra["sperm_generation"] = int(sp.get("geracao", 1))
		extra["sperm_wiring"] = sp.get("fiacao", [])
		extra["sperm_mind"] = CreatureMemory.from_dict(sp.get("memoria", {}))
		extra["sperm_memory"] = _unpack(str(sp.get("memoria_sinapses", "")))
	main.call("spawn_fly", pos, genome, int(d.get("geracao", 1)), syn, int(d.get("linhagem", 0)), str(d.get("sexo", "F")), extra)


static func _fill_stage(o: Node, d: Dictionary) -> void:
	o.set("genome", Genome.from_dict(d.get("genes", {})))
	o.set("memory", _unpack(str(d.get("memoria_sinapses", ""))))
	o.set("mind", CreatureMemory.from_dict(d.get("memoria", {})))
	o.set("wiring", d.get("fiacao", []))
	o.set("parents", d.get("pais", []))
	o.set("uid", int(d.get("id", 0)))
	o.set("generation", int(d.get("geracao", 1)))
	o.set("lineage", int(d.get("linhagem", 0)))


static func _fruit_at(tree: SceneTree, p: Vector3) -> Node3D:
	for n in tree.get_nodes_in_group("odor_source"):
		if n is Fruit and absf((n as Fruit).global_position.distance_to(p) - (n as Fruit).radius) < 6.0:
			return n
	return null


static func _ray(main: Node, a: Vector3, b: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(a, b, 1 | 2)
	return (main as Node3D).get_world_3d().direct_space_state.intersect_ray(q)


# ---------------------------------------------------------------- util
static func _mind(m: CreatureMemory) -> Dictionary:
	return m.to_dict() if m else {}


static func _pack(a: PackedFloat32Array) -> String:
	if a.is_empty():
		return ""
	return Marshalls.raw_to_base64(a.to_byte_array().compress(FileAccess.COMPRESSION_GZIP))


static func _unpack(s: String) -> PackedFloat32Array:
	if s == "":
		return PackedFloat32Array()
	var raw := Marshalls.base64_to_raw(s)
	return raw.decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP).to_float32_array()


static func _v(p: Vector3) -> Array:
	return [snappedf(p.x, 0.01), snappedf(p.y, 0.01), snappedf(p.z, 0.01)]


static func _q(q: Quaternion) -> Array:
	return [q.x, q.y, q.z, q.w]


static func _vec(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))


static func _quat(a: Array) -> Quaternion:
	return Quaternion(float(a[0]), float(a[1]), float(a[2]), float(a[3])).normalized()


static func _write(path: String, d: Dictionary) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(d, "\t"))


static func _read(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))
