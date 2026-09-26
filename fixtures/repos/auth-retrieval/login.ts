import { createSession } from "./session";
export function loginHandler(token: string) {
  return createSession(token);
}
