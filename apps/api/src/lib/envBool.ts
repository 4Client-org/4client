// Parseo explícito de variables de entorno booleanas. `z.coerce.boolean()` convierte
// CUALQUIER string no vacío (incluido "false" y "0") en true, así que REQUIRE_2FA=false
// dejaba el 2FA encendido.
//   true / 1 / yes / on                    -> true
//   false / 0 / no / off / vacío / ausente -> false
// Sin distinguir mayúsculas ni espacios. Cualquier otro valor se trata como true
// (falla cerrado: para una bandera de seguridad es más seguro encender que apagar
// por un typo, y conserva el comportamiento anterior para esos valores).
export function parseEnvBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
}
