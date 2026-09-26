export function refreshSession(token: string) {
  return token + ":rotated";
}
export function createSession(token: string) {
  return refreshSession(token);
}
