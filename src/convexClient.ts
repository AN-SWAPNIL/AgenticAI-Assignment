import { ConvexReactClient } from "convex/react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Run `npx convex dev` and copy the URL into .env.local.",
  );
}

export const convex = new ConvexReactClient(convexUrl);
