class_name OrganBank
## Malhas de orgaos esculpidas offline (tools/build_frog_organs.py e
## tools/build_tadpole_organs.py) e os materiais de tecido
## (shaders/organ*.gdshader), compartilhados por todas as ras e girinos.

const FROG := "res://frog/frog_organs"
const TADPOLE := "res://frog/girino_organs"

## Material de cada tecido: [translucido?, parametros do shader de tecido].
const TISSUE := {
	"ventriculo": [false, {"base_col": Color(0.56, 0.07, 0.08), "vein_col": Color(0.3, 0.02, 0.05), "veins": 0.55, "vein_scale": 16.0, "rough": 0.16, "sss": 0.3}],
	"atrio": [true, {"base_col": Color(0.45, 0.05, 0.14), "vein_col": Color(0.25, 0.02, 0.08), "veins": 0.4, "vein_scale": 22.0, "alpha": 0.85}],
	"cone": [false, {"base_col": Color(0.86, 0.52, 0.5), "vein_col": Color(0.7, 0.2, 0.2), "veins": 0.25}],
	"arteria": [false, {"base_col": Color(0.82, 0.12, 0.12), "mottle": 0.1, "rough": 0.15}],
	"veia": [false, {"base_col": Color(0.3, 0.1, 0.22), "mottle": 0.1, "rough": 0.15}],
	"pulmao": [true, {"base_col": Color(0.96, 0.62, 0.64), "vein_col": Color(0.72, 0.18, 0.28), "cells": 1.0, "cell_scale": 75.0,
		"veins": 0.45, "vein_scale": 14.0, "alpha": 0.7, "rough": 0.2}],
	"cartilagem": [true, {"base_col": Color(0.86, 0.9, 0.93), "rough": 0.3, "alpha": 0.8, "mottle": 0.1}],
	"figado": [false, {"base_col": Color(0.4, 0.11, 0.07), "vein_col": Color(0.26, 0.05, 0.04), "lobules": 0.25, "lobule_scale": 60.0,
		"veins": 0.25, "vein_scale": 12.0, "rough": 0.14, "sss": 0.25}],
	"vesicula": [true, {"base_col": Color(0.22, 0.5, 0.14), "alpha": 0.85, "rough": 0.1}],
	"estomago": [false, {"base_col": Color(0.84, 0.66, 0.6), "vein_col": Color(0.72, 0.16, 0.18), "veins": 0.8, "vein_scale": 13.0, "sss": 0.35}],
	"intestino": [false, {"base_col": Color(0.9, 0.7, 0.62), "vein_col": Color(0.75, 0.2, 0.2), "veins": 0.7, "vein_scale": 22.0, "sss": 0.35}],
	"colon": [false, {"base_col": Color(0.6, 0.54, 0.46), "vein_col": Color(0.6, 0.2, 0.2), "veins": 0.5, "vein_scale": 18.0}],
	"pancreas": [false, {"base_col": Color(0.95, 0.87, 0.7), "lobules": 0.7, "lobule_scale": 110.0, "rough": 0.3}],
	"baco": [false, {"base_col": Color(0.42, 0.07, 0.1), "mottle": 0.35, "rough": 0.2}],
	"rim": [false, {"base_col": Color(0.5, 0.15, 0.11), "vein_col": Color(0.3, 0.05, 0.05), "lobules": 0.3, "lobule_scale": 80.0, "veins": 0.3}],
	"adrenal": [false, {"base_col": Color(1.0, 0.78, 0.28), "rough": 0.3}],
	"ureter": [false, {"base_col": Color(0.95, 0.92, 0.85), "rough": 0.2}],
	"testiculo": [false, {"base_col": Color(0.96, 0.92, 0.72), "vein_col": Color(0.8, 0.3, 0.3), "veins": 0.5, "vein_scale": 30.0}],
	"ovario": [true, {"base_col": Color(0.75, 0.72, 0.66), "vein_col": Color(0.7, 0.25, 0.25), "veins": 0.4, "alpha": 0.22}],
	"oviduto": [false, {"base_col": Color(0.97, 0.95, 0.9), "rough": 0.12, "sss": 0.4}],
	"gordura": [false, {"base_col": Color(1.0, 0.72, 0.18), "lobules": 0.8, "lobule_scale": 130.0, "rough": 0.3}],
	"bexiga": [true, {"base_col": Color(0.92, 0.9, 0.82), "vein_col": Color(0.8, 0.3, 0.3), "veins": 0.5, "vein_scale": 20.0, "alpha": 0.3}],
	"cerebro": [false, {"base_col": Color(0.96, 0.86, 0.8), "vein_col": Color(0.8, 0.22, 0.22), "veins": 0.45, "vein_scale": 45.0, "sss": 0.4}],
	"nervo": [false, {"base_col": Color(0.97, 0.95, 0.86), "fibers": 0.3, "rough": 0.3}],
	"osso": [false, {"base_col": Color(0.8, 0.75, 0.62), "mottle": 0.2, "rough": 0.55, "coat": 0.05, "sss": 0.1}],
	"cranio": [true, {"base_col": Color(0.8, 0.75, 0.62), "mottle": 0.2, "rough": 0.55, "coat": 0.05, "alpha": 0.5}],
	"musculo": [true, {"base_col": Color(0.7, 0.18, 0.17), "fibers": 1.0, "bulge": 0.007, "rough": 0.3, "coat": 0.3, "alpha": 0.85}],
	"tendao": [false, {"base_col": Color(0.95, 0.93, 0.88), "fibers": 0.5, "rough": 0.15}],
	# girino
	"intestino_girino": [false, {"base_col": Color(0.2, 0.24, 0.09), "vein_col": Color(0.55, 0.22, 0.12), "veins": 0.3, "vein_scale": 40.0,
		"mottle": 0.5, "rough": 0.3, "coat": 0.3, "sss": 0.2}],
	"manicotto": [false, {"base_col": Color(0.42, 0.44, 0.24), "vein_col": Color(0.6, 0.25, 0.15), "veins": 0.35, "vein_scale": 50.0, "mottle": 0.4, "coat": 0.3}],
	"branquia": [false, {"base_col": Color(0.88, 0.16, 0.22), "vein_col": Color(0.55, 0.03, 0.08), "veins": 0.5, "vein_scale": 90.0, "rough": 0.15}],
	"notocorda": [true, {"base_col": Color(0.9, 0.92, 0.88), "cells": 0.6, "cell_scale": 180.0, "vein_col": Color(0.7, 0.72, 0.7), "alpha": 0.75}],
}


static var _cache := {}
static var _meta := {}
static var _mats := {}
static var _egg: ArrayMesh


static func meshes(path: String) -> Array:
	_load(path)
	return _cache[path]


static func meta(path: String) -> Dictionary:
	_load(path)
	return _meta[path]


## Ovulo: esfera com o polo animal escuro (melanina) e o vegetal creme.
static func egg_mesh() -> ArrayMesh:
	if _egg:
		return _egg
	var sm := SphereMesh.new()
	sm.radius = 1.0
	sm.height = 2.0
	sm.radial_segments = 10
	sm.rings = 6
	var sa := sm.get_mesh_arrays()
	var cols := PackedColorArray()
	for v: Vector3 in sa[Mesh.ARRAY_VERTEX]:
		cols.append(Color(0.08, 0.06, 0.05).lerp(Color(0.95, 0.9, 0.72), 1.0 - smoothstep(-0.15, 0.15, v.y)))
	sa[Mesh.ARRAY_COLOR] = cols
	_egg = ArrayMesh.new()
	_egg.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, sa)
	return _egg


static func _read_str(f: FileAccess) -> String:
	return f.get_buffer(f.get_16()).get_string_from_utf8()


static func _load(path: String) -> void:
	if _cache.has(path):
		return
	var t0 := Time.get_ticks_msec()
	var list := []
	_cache[path] = list
	_meta[path] = JSON.parse_string(FileAccess.get_file_as_string(path + ".json"))
	var f := FileAccess.open(path + ".bin", FileAccess.READ)
	f.get_buffer(4)
	var count := f.get_32()
	for i in count:
		var e := {"name": _read_str(f), "bone": _read_str(f), "mat": _read_str(f)}
		e["pivot"] = Vector3(f.get_float(), f.get_float(), f.get_float())
		var nv := f.get_32()
		var ni := f.get_32()
		# ORG2: posicao float16, normal int8, cor uint8
		var pos := f.get_buffer(nv * 6)
		var nrm := f.get_buffer(nv * 3)
		var col := f.get_buffer(nv * 4)
		var idx := f.get_buffer(ni * 4).to_int32_array()
		var pv := PackedVector3Array()
		var nn := PackedVector3Array()
		var cc := PackedColorArray()
		pv.resize(nv)
		nn.resize(nv)
		cc.resize(nv)
		for k in nv:
			pv[k] = Vector3(pos.decode_half(k * 6), pos.decode_half(k * 6 + 2), pos.decode_half(k * 6 + 4))
			nn[k] = Vector3(nrm.decode_s8(k * 3), nrm.decode_s8(k * 3 + 1), nrm.decode_s8(k * 3 + 2)) / 127.0
			cc[k] = Color8(col[k * 4], col[k * 4 + 1], col[k * 4 + 2], col[k * 4 + 3])
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = pv
		arr[Mesh.ARRAY_NORMAL] = nn
		arr[Mesh.ARRAY_COLOR] = cc
		arr[Mesh.ARRAY_INDEX] = idx
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		e["mesh"] = m
		list.append(e)
	print("OrganBank: %d orgaos de %s em %d ms" % [count, path.get_file(), Time.get_ticks_msec() - t0])


static func tissue(key: String) -> ShaderMaterial:
	if _mats.has(key):
		return _mats[key]
	var spec: Array = TISSUE.get(key, [false, {}])
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/organ_alpha.gdshader" if spec[0] else "res://shaders/organ.gdshader")
	var params: Dictionary = spec[1]
	for k in params:
		var v = params[k]
		m.set_shader_parameter(k, Vector3(v.r, v.g, v.b) if v is Color else v)
	_mats[key] = m
	return m
