import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-6xl font-bold">404</h1>
      <p className="text-neutral-400">Page not found</p>
      <Link
        to="/"
        className="mt-4 text-sm text-neutral-400 underline transition hover:text-white"
      >
        Back to home
      </Link>
    </div>
  );
}
