'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/utils';
import { toast } from '@/lib/toast';
import { useSidebar } from '@/components/ui/sidebar';
import { useCreateOpenCodeSession } from '@/hooks/opencode/use-opencode-sessions';
import { DynamicGreeting } from '@/components/ui/dynamic-greeting';
import { Menu, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function DashboardContent() {
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const router = useRouter();
  const isMobile = useIsMobile();
  const { setOpen: setSidebarOpenState, setOpenMobile } = useSidebar();
  const createSession = useCreateOpenCodeSession();

  const handleSubmit = useCallback(
    async (message?: string) => {
      const text = (message ?? inputValue).trim();
      if (!text || isSubmitting) return;
      setIsSubmitting(true);
      try {
        sessionStorage.setItem('opencode_pending_prompt', text);
        const session = await createSession.mutateAsync();
        router.push(`/sessions/${session.id}?new=true`);
      } catch (error) {
        sessionStorage.removeItem('opencode_pending_prompt');
        setIsSubmitting(false);
        toast.error('Failed to create session');
      }
    },
    [inputValue, isSubmitting, createSession, router],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden relative">
      {/* Brandmark Background */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        <img
          src="/kortix-brandmark-bg.svg"
          alt=""
          className="absolute left-1/2 -translate-x-1/2 top-[-10%] sm:top-1/2 sm:-translate-y-1/2 w-[140vw] min-w-[700px] h-auto sm:w-[160vw] sm:min-w-[1000px] md:min-w-[1200px] lg:w-[162vw] lg:min-w-[1620px] object-contain select-none invert dark:invert-0"
          draggable={false}
        />
      </div>

      {/* Mobile menu button */}
      {isMobile && (
        <div className="absolute left-3 top-1.5 z-10">
          <button
            onClick={() => {
              setSidebarOpenState(true);
              setOpenMobile(true);
            }}
            className="flex items-center justify-center h-9 w-9 -ml-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 active:bg-accent transition-colors touch-manipulation"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col relative z-[1]">
        {/* Centered: Greeting + Subtitle */}
        <div className="absolute inset-0 flex items-center justify-center px-4 pb-28 sm:pb-0 pointer-events-none">
          <div className="w-full max-w-3xl mx-auto flex flex-col items-center text-center pointer-events-auto">
            <div className="animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both">
              <DynamicGreeting className="text-2xl sm:text-3xl md:text-4xl font-medium text-foreground tracking-tight" />
            </div>

            <p className="mt-2 sm:mt-3 text-sm sm:text-base text-muted-foreground/70 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 delay-75 fill-mode-both">
              Ask anything about your code
            </p>
          </div>
        </div>

        {/* Chat Input - fixed at bottom */}
        <div className="absolute bottom-0 left-0 right-0 px-3 sm:px-4 pb-3 sm:pb-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] animate-in fade-in-0 slide-in-from-bottom-4 duration-500 delay-100 fill-mode-both">
          <div className="w-full max-w-3xl mx-auto">
            <Card className="shadow-none w-full bg-transparent border-none overflow-visible py-0 pb-5 rounded-3xl relative z-10">
              <div className="w-full text-sm flex flex-col justify-between items-start rounded-lg overflow-visible">
                <CardContent className="w-full p-1.5 pb-2 bg-card border rounded-[24px] overflow-visible">
                  <div className="relative flex flex-col w-full h-full gap-2 justify-between overflow-visible">
                    <div className="flex flex-col gap-1 px-2">
                      <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask anything..."
                        rows={1}
                        disabled={isSubmitting}
                        className="w-full bg-transparent border-none shadow-none focus-visible:ring-0 px-0.5 pb-6 pt-4 min-h-[72px] max-h-[200px] overflow-y-auto resize-none rounded-[24px] text-[16px] sm:text-[15px] outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
                        autoFocus={!isMobile}
                      />
                    </div>
                    <div className="flex items-center justify-end mt-0 mb-1 px-1.5 sm:px-2 gap-1 sm:gap-1.5">
                      <Button
                        size="sm"
                        disabled={!inputValue.trim() || isSubmitting}
                        onClick={() => handleSubmit()}
                        className="flex-shrink-0 self-end border-[1.5px] border-border rounded-2xl w-10 h-10"
                      >
                        {isSubmitting ? (
                          <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <ArrowUp className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
