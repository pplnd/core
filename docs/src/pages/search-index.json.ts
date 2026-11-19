import type { APIRoute } from "astro";
import { getAllSearchItems } from "../apiSearch";

export const GET: APIRoute = () =>
	new Response(JSON.stringify(getAllSearchItems()), { headers: { "Content-Type": "application/json; charset=utf-8" } });
