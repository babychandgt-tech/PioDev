import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

// Auth & Context
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/hooks/use-theme";

// Pages
import LandingPage from "@/pages/landing";
import Login from "@/pages/login";
import Register from "@/pages/register";
import ForgotPassword from "@/pages/forgot-password";
import ChatPage from "@/pages/chat";
import Settings from "@/pages/settings";
import AdminPage from "@/pages/admin";
import WhatsNewPage from "@/pages/whats-new";
import CheckEmail from "@/pages/check-email";
import VideoStudio from "@/pages/video-studio";
import VoiceStudio from "@/pages/voice-studio";
import ImageStudio from "@/pages/image-studio";
import GaleriStudio from "@/pages/galeri-studio";
import PremiumPricingPage from "@/pages/premium-pricing";
import ResetPassword from "@/pages/reset-password";
import ApiKeysPage from "@/pages/api-keys";
import PustakaPage from "@/pages/pustaka";
import HostingPage from "@/pages/hosting";
import HelpCenterPage from "@/pages/help-center";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/chat" component={ChatPage} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/settings" component={Settings} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/whats-new" component={WhatsNewPage} />
      <Route path="/check-email" component={CheckEmail} />
      <Route path="/video-studio" component={VideoStudio} />
      <Route path="/voice-studio" component={VoiceStudio} />
      <Route path="/image-studio" component={ImageStudio} />
      <Route path="/galeri-studio" component={GaleriStudio} />
      <Route path="/premium" component={PremiumPricingPage} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/api-keys" component={ApiKeysPage} />
      <Route path="/pustaka" component={PustakaPage} />
      <Route path="/hosting" component={HostingPage} />
      <Route path="/bantuan" component={HelpCenterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
        </ThemeProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
