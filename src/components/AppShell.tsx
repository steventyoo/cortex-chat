'use client';

import { useState, useCallback, useEffect, createContext, useContext, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { useSessionProvider, SessionContext } from '@/hooks/useSession';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { ProjectSummary } from '@/lib/types';
import Sidebar, { SidebarFooter } from './Sidebar';

const FooterContext = createContext<{
  setFooter: (node: ReactNode) => void;
}>({ setFooter: () => {} });

export function useAppShellFooter() {
  return useContext(FooterContext);
}

interface AppShellProps {
  projects: ProjectSummary[];
  children: ReactNode;
}

export default function AppShell({ projects, children }: AppShellProps) {
  const session = useSessionProvider();
  const { user, isAdmin } = session;
  const pathname = usePathname();
  const router = useRouter();

  const {
    currentConversationId,
    loadConversation,
    startNewConversation,
    deleteConversation,
    getSummaries,
  } = useConversationHistory();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [footer, setFooter] = useState<ReactNode>(null);

  const hasFooter = footer != null;
  const currentView = deriveView(pathname);
  const conversationSummaries = getSummaries();

  const handleGoHome = useCallback(() => {
    router.push('/');
  }, [router]);

  const handleNewChat = useCallback(() => {
    startNewConversation();
    router.push('/');
  }, [startNewConversation, router]);

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setSelectedProject(projectId);
      setSidebarOpen(false);
      router.push(`/?project=${projectId}`);
    },
    [router]
  );

  const handleSelectConversation = useCallback(
    (convId: string) => {
      loadConversation(convId);
      setSidebarOpen(false);
    },
    [loadConversation]
  );

  const handleNavigate = useCallback(
    (view: 'chat' | 'pipeline' | 'dashboard') => {
      setSidebarOpen(false);
      if (view === 'pipeline') {
        router.push('/review');
      } else {
        router.push('/');
      }
    },
    [router]
  );

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const sidebarProps = {
    projects,
    selectedProject,
    onSelectProject: handleSelectProject,
    onNewChat: handleNewChat,
    onGoHome: handleGoHome,
    conversations: conversationSummaries,
    activeConversationId: currentConversationId,
    onSelectConversation: handleSelectConversation,
    onDeleteConversation: deleteConversation,
    currentView,
    onNavigate: handleNavigate,
    isAdmin,
    userName: user?.name,
    userEmail: user?.email,
    onLogout: session.logout,
  };

  return (
    <SessionContext.Provider value={session}>
      <FooterContext.Provider value={{ setFooter }}>
      <div className={`flex flex-col h-dvh bg-white lg:grid lg:grid-cols-[260px_1fr] ${
        hasFooter ? 'lg:grid-rows-[1fr_auto]' : 'lg:grid-rows-[1fr]'
      }`}>
        {/* Desktop sidebar — single column when no footer, split into 2 rows when footer exists */}
        <div className={`hidden lg:flex lg:flex-col lg:overflow-hidden lg:border-r lg:border-[#e8e8e8] lg:bg-[#f7f7f5] lg:col-start-1 ${
          hasFooter ? 'lg:row-start-1' : 'lg:row-span-full'
        }`}>
          <Sidebar
            {...sidebarProps}
            isOpen={true}
            onToggle={() => {}}
            hideFooter={hasFooter}
          />
        </div>

        {/* Desktop sidebar footer — only as separate grid cell when footer exists (for border alignment) */}
        {hasFooter ? (
          <div className="hidden lg:flex lg:items-end lg:row-start-2 lg:col-start-1 lg:border-r lg:border-[#e8e8e8] lg:bg-[#f7f7f5]">
            <SidebarFooter
              userName={user?.name}
              userEmail={user?.email}
              onLogout={session.logout}
            />
          </div>
        ) : null}

        {/* Mobile sidebar overlay */}
        <div className="lg:hidden">
          <Sidebar
            {...sidebarProps}
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
          />
        </div>

        {/* Main content — row 1, col 2 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden lg:row-start-1 lg:col-start-2">
          {/* Mobile header with hamburger */}
          <div className="flex items-center gap-3 px-5 h-[52px] border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0 lg:hidden">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg hover:bg-[#f0f0f0] text-[#6b6b6b] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <Image
              src="/owp-logo.png"
              alt="One Way Plumbing"
              width={150}
              height={30}
              className="h-[24px] w-auto"
            />
          </div>

          {children}
        </div>

        {/* Footer slot — row 2, col 2 (only when footer registered) */}
        {hasFooter ? (
          <div className="lg:row-start-2 lg:col-start-2">{footer}</div>
        ) : null}
      </div>
      </FooterContext.Provider>
    </SessionContext.Provider>
  );
}

function deriveView(pathname: string): 'chat' | 'pipeline' | 'dashboard' {
  if (pathname === '/review') return 'pipeline';
  if (pathname.startsWith('/staff-')) return 'chat';
  if (pathname === '/daily-notes') return 'chat';
  return 'chat';
}
