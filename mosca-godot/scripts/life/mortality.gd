class_name Mortality
extends RefCounted
## Velhice e quedas, iguais para todos os bichos.
##
## Velhice (lei de Gompertz): o risco de morrer por segundo cresce
## exponencialmente com a idade, ~150x do jovem ao velho. A idade mediana de
## morte e o "lifespan" do genoma; uns morrem antes, outros passam dele, e
## os velhos vao ficando mais fracos e lentos (vigor).
##
## Quedas: a velocidade no impacto e a da queda livre, limitada pela
## velocidade terminal (o ar freia): bichos pequenos e leves quase nao se
## machucam, uma ra caindo de alto se machuca ou morre.

const G := 9800.0     # mm/s^2


static func age_hazard(age: float, lifespan: float) -> float:
	var b := 5.0 / maxf(lifespan, 1.0)
	var a := log(2.0) * b / (exp(5.0) - 1.0)
	return a * exp(b * age)


static func dies_of_age(age: float, lifespan: float, dt: float, rng: RandomNumberGenerator) -> bool:
	return rng.randf() < age_hazard(age, lifespan) * dt


## 1 no adulto jovem, cai para ~0.55 na velhice avancada.
static func vigor(age: float, lifespan: float) -> float:
	return 1.0 - 0.45 * smoothstep(0.55, 1.3, age / maxf(lifespan, 1.0))


static func impact_speed(height: float, v_terminal: float) -> float:
	var v := sqrt(2.0 * G * maxf(height, 0.0))
	return v * v_terminal / sqrt(v * v + v_terminal * v_terminal)


## Dano (0..) de um impacto: nada abaixo de 'safe', morte em 'lethal'.
static func impact_damage(speed: float, safe: float, lethal: float) -> float:
	return maxf(0.0, (speed - safe) / maxf(lethal - safe, 1.0))
