import Image from "next/image";
import Simulate from "./pages/MainPage/page";
export default function Home() {
  return (
    <div className="flex min-h-screen text-xl items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <Simulate />
    </div>
  );
}
