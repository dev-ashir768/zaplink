/** The payload of a success response: the API wraps every JSON answer as `{ success, message, data }`. */
export function dataOf(res: { body: unknown }): unknown {
  return (res.body as { data: unknown }).data;
}
