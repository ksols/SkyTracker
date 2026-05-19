import { signIn } from "@/lib/auth";

export default function LoginPage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm w-full flex flex-col gap-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ocean-1 dark:text-white">SkyTracker</h1>
          <p className="text-sm text-slate-500 dark:text-skyblue-2 mt-1">Sign in to continue.</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-ocean-5 text-white py-2.5 text-sm font-medium hover:bg-ocean-6 transition"
          >
            Sign in with Microsoft Entra ID
          </button>
        </form>
      </div>
    </main>
  );
}
