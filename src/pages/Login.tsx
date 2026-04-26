import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Factory, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary mb-4">
            <Factory className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            Cansport Global Industries
          </h1>
          <p className="text-muted-foreground mt-1">
            Enterprise Resource Planning System
          </p>
        </div>

        {/* Login Card */}
        <Card className="border-2">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl font-display">Sign In</CardTitle>
            <CardDescription>
              Enter your user ID and password to access the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="userId">User ID</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="userId"
                    placeholder="Enter your user ID"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Contact your administrator if you need access or forgot your password
        </p>
      </div>
    </div>
  );
}
