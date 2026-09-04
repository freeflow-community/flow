import Image from "next/image";

export function PrismAvatar({ className = "size-7" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-[8px] bg-[#e9fbff] p-0.5 ring-1 ring-[#09b8d5]/30 ${className}`}
      aria-hidden="true"
    >
      <Image
        src="/media/prism-bot.png"
        alt=""
        width={512}
        height={512}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
