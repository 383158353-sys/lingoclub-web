import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import SiteLayout from './components/layout/SiteLayout';
import Home from './pages/Home';
import Collection from './pages/Collection';
import Login from '@/pages/Login';
import LocalStudy from './pages/LocalStudy';
import ExtensionGuide from './pages/ExtensionGuide';

// Keep legacy Base44 pages available without loading their SDK on core local routes.
const PageNotFound = lazy(() => import('./lib/PageNotFound'));
const Communities = lazy(() => import('./pages/Communities'));
const MovieCommunity = lazy(() => import('./pages/MovieCommunity'));
const EpisodePage = lazy(() => import('./pages/EpisodePage'));
const SceneStudy = lazy(() => import('./pages/SceneStudy'));
const MyProjects = lazy(() => import('./pages/MyProjects'));
const Profile = lazy(() => import('./pages/Profile'));
const CreatorStudio = lazy(() => import('./pages/CreatorStudio'));
const StudioManage = lazy(() => import('./pages/StudioManage'));
const ReviewQueue = lazy(() => import('./pages/ReviewQueue'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const BuyCredits = lazy(() => import('./pages/BuyCredits'));
const ThankYou = lazy(() => import('./pages/ThankYou'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const QuickStudy = lazy(() => import('./pages/QuickStudy'));
const BilibiliStudy = lazy(() => import('./pages/BilibiliStudy'));
const PublishFolder = lazy(() => import('./pages/PublishFolder'));
const SubtitleSegmentation = lazy(() => import('./pages/SubtitleSegmentation'));

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError } = useAuth();

  // Identity gates protected requests. Public settings load independently and
  // must not keep a valid guest session on a blank spinner.
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Authentication errors: only user_not_registered aborts rendering;
  // the old auth_required redirect is gone — unauthenticated visitors browse
  // normally and are sent to /login by useRequireAuth when taking gated actions.
  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Render the main app
  return (
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>}>
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
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
