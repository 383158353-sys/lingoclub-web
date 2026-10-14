import { lazy, Suspense, useEffect, useState } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import SiteLayout from './components/layout/SiteLayout';
import Home from './pages/Home';
import Login from '@/pages/Login';

// Chunk downloads fail intermittently on mobile networks in China; retry once, then
// reload the page once (fresh index.html after a deploy) instead of a dead screen.
function lazyRetry(factory) {
  return lazy(() => factory().catch(() => new Promise((r) => setTimeout(r, 1500)).then(factory)).catch((error) => {
    try {
      if (!sessionStorage.getItem('lc:chunk-reload')) { sessionStorage.setItem('lc:chunk-reload', '1'); window.location.reload(); return new Promise(() => {}); }
    } catch { /* storage optional */ }
    throw error;
  }));
}

// Keep legacy Base44 pages available without loading their SDK on core local routes.
const PageNotFound = lazyRetry(() => import('./lib/PageNotFound'));
const Collection = lazyRetry(() => import('./pages/Collection'));
const LocalStudy = lazyRetry(() => import('./pages/LocalStudy'));
const ExtensionGuide = lazyRetry(() => import('./pages/ExtensionGuide'));
const Communities = lazyRetry(() => import('./pages/Communities'));
const MovieCommunity = lazyRetry(() => import('./pages/MovieCommunity'));
const EpisodePage = lazyRetry(() => import('./pages/EpisodePage'));
const SceneStudy = lazyRetry(() => import('./pages/SceneStudy'));
const MyProjects = lazyRetry(() => import('./pages/MyProjects'));
const Profile = lazyRetry(() => import('./pages/Profile'));
const CreatorStudio = lazyRetry(() => import('./pages/CreatorStudio'));
const StudioManage = lazyRetry(() => import('./pages/StudioManage'));
const ReviewQueue = lazyRetry(() => import('./pages/ReviewQueue'));
const Register = lazyRetry(() => import('@/pages/Register'));
const ForgotPassword = lazyRetry(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazyRetry(() => import('@/pages/ResetPassword'));
const BuyCredits = lazyRetry(() => import('./pages/BuyCredits'));
const ThankYou = lazyRetry(() => import('./pages/ThankYou'));
const AdminUsers = lazyRetry(() => import('./pages/AdminUsers'));
const QuickStudy = lazyRetry(() => import('./pages/QuickStudy'));
const DailyRecommendations = lazyRetry(() => import('./pages/DailyRecommendations'));
const DailyArticleReader = lazyRetry(() => import('./pages/DailyArticleReader'));
const BilibiliStudy = lazyRetry(() => import('./pages/BilibiliStudy'));
const PublishFolder = lazyRetry(() => import('./pages/PublishFolder'));
const SubtitleSegmentation = lazyRetry(() => import('./pages/SubtitleSegmentation'));


// Dark, theme-matching loader. If it is still visible after 12s (slow chunk / network),
// show a retry button instead of spinning forever.
function PageLoader() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 12000); return () => clearTimeout(t); }, []);
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#0b0c0f] text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/15 border-t-white/80" />
      {slow && (
        <>
          <p>网络有点慢，还在加载…</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-white/10 px-4 py-2 text-white active:bg-white/20">重新加载</button>
        </>
      )}
    </div>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError } = useAuth();

  // Identity gates protected requests. Public settings load independently and
  // must not keep a valid guest session on a blank spinner.
  if (isLoadingAuth) {
    return <PageLoader />;
  }

  // Authentication errors: only user_not_registered aborts rendering;
  // the old auth_required redirect is gone — unauthenticated visitors browse
  // normally and are sent to /login by useRequireAuth when taking gated actions.
  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Render the main app
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Public auth routes — no site chrome */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/bili-study" element={<BilibiliStudy />} />
      {/* Add your page Route elements here */}
      <Route element={<SiteLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/communities" element={<Communities />} />
        <Route path="/movie/:movieId" element={<MovieCommunity />} />
        <Route path="/episode/:episodeId" element={<EpisodePage />} />
        <Route path="/scene/:sceneId" element={<SceneStudy />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/my-projects" element={<MyProjects />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/studio" element={<CreatorStudio />} />
        <Route path="/studio/review" element={<ReviewQueue />} />
        <Route path="/studio/:movieId" element={<StudioManage />} />
        <Route path="/buy-credits" element={<BuyCredits />} />
        <Route path="/ThankYou" element={<ThankYou />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/local-study" element={<LocalStudy />} />
        <Route path="/quick-study" element={<QuickStudy />} />
        <Route path="/recommendations" element={<DailyRecommendations />} />
        <Route path="/articles/:id" element={<DailyArticleReader />} />
        <Route path="/extension" element={<ExtensionGuide />} />
        <Route path="/publish-folder/:folderId" element={<PublishFolder />} />
        <Route path="/subtitle-segmentation" element={<SubtitleSegmentation />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        {import.meta.env.DEV && <div className="fixed bottom-3 right-3 z-[99999] rounded-md border border-amber-300/50 bg-amber-950/90 px-2 py-1 text-[10px] font-bold tracking-widest text-amber-200 shadow-lg">DEV</div>}
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
