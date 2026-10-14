// Vercel function: stream and playlist relay.
import { handleProxy } from "../lib/proxy.js";
export const GET = handleProxy;
export const HEAD = handleProxy;
export const OPTIONS = handleProxy;
