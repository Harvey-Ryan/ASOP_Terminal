import { Construction } from 'lucide-react';

export function CraftingCalculatorPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-24 space-y-4">
      <div className="rounded-full bg-yellow-500/10 border border-yellow-500/30 p-5">
        <Construction className="h-10 w-10 text-yellow-500" />
      </div>
      <div className="space-y-2 max-w-md">
        <h1 className="text-2xl font-bold tracking-tight">Crafting Calculator</h1>
        <p className="text-muted-foreground text-sm">
          The crafting calculator is currently under development. Check back soon — it will let
          you plan material costs, estimate production timelines, and optimize crafting runs
          across multiple blueprints.
        </p>
      </div>
    </div>
  );
}
