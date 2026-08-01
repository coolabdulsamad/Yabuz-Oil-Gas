import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-6xl font-black text-[#22264B]/15">404</p>
      <h2 className="mt-2 text-xl font-bold text-[#22264B]">Page not found</h2>
      <p className="mt-1 text-sm text-[#22264B]/55">
        The page you're looking for doesn't exist or you don't have access to it.
      </p>
      <Button asChild className="mt-5 bg-[#22264B] text-white hover:bg-[#22264B]/90">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
