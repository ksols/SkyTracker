import { signOut } from "@/lib/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="text-xs text-slate-500 dark:text-ocean-6 hover:text-ocean-1 dark:hover:text-skyblue-1 transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
