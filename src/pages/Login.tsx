import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Factory, Lock, User, ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

export default function Login() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const result = await login(userId, password);

    if (result.success) {
      toast({
        title: "Login Successful",
        description: `Welcome back, ${userId}!`,
      });
      navigate("/");
    } else {
      toast({
        title: "Login Failed",
        description: result.error || "Please enter valid credentials.",
        variant: "destructive",
      });
    }
    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-background">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-accent/25 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-info/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
      </div>

      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="relative inline-flex items-center justify-center mb-5">
            <div className="absolute inset-0 bg-brand-gradient blur-2xl opacity-50" />
            <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-gradient shadow-glow">
              <Factory className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="font-display text-3xl font-bold text-foreground tracking-tight">
            Cansport Global Industries
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Enterprise Resource Planning System
          </p>
        </div>

        {/* Login Card */}
        <div className="relative">
          <div className="absolute -inset-px rounded-2xl bg-brand-gradient opacity-30 blur-md" />
          <div className="relative rounded-2xl border border-border/80 bg-card/90 backdrop-blur-xl shadow-elevated overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="mb-6 space-y-1">
                <h2 className="text-xl font-display font-bold tracking-tight">Welcome back</h2>
                <p className="text-sm text-muted-foreground">
                  Sign in with your user ID and password to continue.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="userId" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    User ID
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="userId"
                      placeholder="e.g. john.doe"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      className="pl-10 h-11"
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 h-11"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  variant="gradient"
                  className="w-full h-11 mt-2 group"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    "Signing in…"
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>Secured with role-based access control</span>
              </div>
            </div>

            <div className="border-t border-border/60 bg-muted/40 px-6 py-3 text-center text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                Need access? Contact your administrator.
              </span>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          © {new Date().getFullYear()} Cansport Global Industries · All rights reserved
        </p>
      </div>
    </div>
  );
}
