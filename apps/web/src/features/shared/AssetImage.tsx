import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { storageService, type Bucket } from "@/services/storage";
import { cn } from "@/lib/utils";

export function useSignedUrl(bucket: Bucket | string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["signed", bucket, path],
    queryFn: () => storageService.signedUrl(bucket as Bucket, path!, 3600),
    enabled: Boolean(bucket && path),
    staleTime: 50 * 60_000,
  });
}

export function AssetImage({ bucket, path, alt, className, imgClassName }: {
  bucket: Bucket | string | null | undefined; path: string | null | undefined; alt: string; className?: string; imgClassName?: string;
}) {
  const { data, isError } = useSignedUrl(bucket, path);
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden bg-side", className)}>
      {isError ? <ImageOff className="size-5 text-muted" /> : data ? <img src={data} alt={alt} loading="lazy" className={cn("h-full w-full object-contain", imgClassName)} />
        : <div className="h-full w-full animate-pulse bg-hover" />}
    </div>
  );
}
