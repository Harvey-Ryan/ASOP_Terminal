// Pick an image from the server's image library, or upload one (v1.36.0):
// briefing logos and maps. The library is the same one event images use.
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { imagesApi } from '@/api/images';
import { cn } from '@/lib/utils';
import { ImageUsage } from '@/components/ImageUsage';

export function ServerImagePicker({ guildId, value, onChange, emptyLabel = 'None' }: {
  guildId: string;
  value: string | null;
  onChange: (url: string | null) => void;
  emptyLabel?: string;
}) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { data: images = [] } = useQuery({ queryKey: ['images', guildId], queryFn: () => imagesApi.list(guildId), enabled: open });

  const upload = async (f: File) => {
    setUploading(true); setError(null);
    try {
      const img = await imagesApi.upload(guildId, f);
      await qc.invalidateQueries({ queryKey: ['images', guildId] });
      onChange(img.url);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-dashed border-brand/50 bg-black/30 hover:border-brand">
          {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <ImagePlus aria-hidden="true" className="h-6 w-6 text-muted-foreground" />}
        </button>
        <div className="flex flex-col gap-1 text-xs">
          <button type="button" className="text-left text-brand hover:underline" onClick={() => setOpen((o) => !o)}>{value ? 'Change' : 'Choose an image'}</button>
          {value && <button type="button" className="flex items-center gap-1 text-left text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}><X className="h-3 w-3" />{emptyLabel}</button>}
        </div>
      </div>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-card p-2">
          <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            <button type="button" disabled={uploading} onClick={() => file.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded border border-dashed border-border text-[11px] text-muted-foreground hover:border-brand hover:text-foreground">
              <ImagePlus className="h-4 w-4" />{uploading ? 'Uploading…' : 'Upload'}
            </button>
            {images.map((img) => (
              <button key={img.id} type="button" onClick={() => { onChange(img.url); setOpen(false); }}
                className={cn('aspect-square overflow-hidden rounded border', img.url === value ? 'border-brand ring-1 ring-brand' : 'border-border hover:border-brand/60')}>
                <img src={img.url} alt={img.filename} loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <ImageUsage guildId={guildId} className="mt-2" />
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </div>
      )}
    </div>
  );
}
