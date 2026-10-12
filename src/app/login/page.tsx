import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

async function login(form: FormData) {
  "use server";
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  if (String(form.get("password")) !== password) redirect("/login?error=1");
  (await cookies()).set(AUTH_COOKIE, await tokenFor(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/");
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <form action={login} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-stone-900 text-sm text-white">⚡</span>
          Funding Outreach Engine
        </div>
        <label className="block">
          <span className="label">Password</span>
          <input name="password" type="password" className="input" autoFocus required />
        </label>
        {error && <p className="text-sm text-red-600">Wrong password.</p>}
        <button className="btn btn-primary w-full">Sign in</button>
      </form>
    </div>
  );
}
