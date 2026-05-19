import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    role: "writer" | "reader";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "writer" | "reader";
  }
}
