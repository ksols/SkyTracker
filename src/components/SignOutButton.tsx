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
        className="text-xs text-zinc-500 hover:text-black dark:hover:text-zinc-100 transition-colors"
      >
        Sign out
      </button>
    </form>
  );
}
