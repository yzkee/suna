"use client";

import { useState, useMemo } from "react";
import { ChevronDown, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RevertDockItem {
	id: string;
	text: string;
}

interface SessionRevertDockProps {
	items: RevertDockItem[];
	restoring?: string;
	disabled?: boolean;
	onRestore: (id: string) => void;
}

export function SessionRevertDock({
	items,
	restoring,
	disabled,
	onRestore,
}: SessionRevertDockProps) {
	const [collapsed, setCollapsed] = useState(true);

	const total = items.length;
	const label = total === 1 ? "1 rolled back message" : `${total} rolled back messages`;
	const preview = items[0]?.text ?? "";

	if (total === 0) return null;

	return (
		<div className="rounded-lg border border-border/60 bg-muted/40 overflow-hidden">
			{/* Header — always visible, clickable to toggle */}
			<button
				type="button"
				onClick={() => setCollapsed((v) => !v)}
				className="w-full flex items-center gap-2 pl-3 pr-2 py-2 text-left cursor-pointer hover:bg-muted/60 transition-colors"
			>
				<Undo2 className="size-3.5 text-muted-foreground flex-shrink-0" />
				<span className="shrink-0 text-sm font-medium text-foreground">
					{label}
				</span>
				{collapsed && preview && (
					<span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
						{preview}
					</span>
				)}
				<ChevronDown
					className={cn(
						"size-4 text-muted-foreground ml-auto flex-shrink-0 transition-transform duration-200",
						collapsed && "rotate-180",
					)}
				/>
			</button>

			{/* Expanded list */}
			{!collapsed && (
				<div className="px-3 pb-3 flex flex-col gap-1.5 max-h-42 overflow-y-auto">
					{items.map((item) => (
						<div
							key={item.id}
							className="flex items-center gap-2 min-w-0 py-1"
						>
							<span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
								{item.text}
							</span>
							<Button
								variant="outline"
								size="sm"
								className="shrink-0 h-7 text-xs"
								disabled={disabled || !!restoring}
								onClick={() => onRestore(item.id)}
							>
								{restoring === item.id ? (
									<Loader2 className="size-3 mr-1 animate-spin" />
								) : null}
								Restore
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
