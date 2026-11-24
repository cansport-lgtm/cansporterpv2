import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export default function AccountSettingsPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [savingContact, setSavingContact] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const fail = (title: string, description?: string) => toast({ title, description, variant: "destructive" });

  const setAvatar = async (url: string | null) => {
    const { error } = await supabase.from("app_users").update({ avatar_url: url }).eq("id", user!.id);
    if (error) throw error;
    await refreshUser();
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) return fail("Please choose an image file");
    if (file.size > MAX_AVATAR_BYTES) return fail("Image too large", "Maximum size is 2 MB.");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("user-avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("user-avatars").getPublicUrl(path);
      await setAvatar(data.publicUrl);
      toast({ title: "Profile photo updated" });
    } catch (err) {
      fail("Could not update photo", err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    setUploading(true);
    try {
      await setAvatar(null);
      toast({ title: "Profile photo removed" });
    } catch (err) {
      fail("Could not remove photo", err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  };

  const saveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return fail("Enter a valid email address");
    setSavingContact(true);
    const { error } = await supabase
      .from("app_users")
      .update({ phone: phone.trim() || null, email: email.trim() || null })
      .eq("id", user.id);
    setSavingContact(false);
    if (error) return fail("Could not save details", error.message);
    await refreshUser();
    toast({ title: "Contact details saved" });
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (next.length < 6) return fail("Password too short", "Use at least 6 characters.");
    if (next !== confirm) return fail("Passwords do not match");
    if (next === current) return fail("New password must differ from the current one");
    setSavingPw(true);
    const { data, error } = await supabase.rpc("change_own_password", {
      p_user_uuid: user.id,
      p_current_password: current,
      p_new_password: next,
    });
    setSavingPw(false);
    if (error) return fail("Could not change password", error.message);
    if (!data) return fail("Current password is incorrect");
    setCurrent("");
    setNext("");
    setConfirm("");
    toast({ title: "Password changed", description: "Use your new password next time you sign in." });
  };

  return (
    <ERPLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your photo, contact details and password.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile photo</CardTitle>
            <CardDescription>JPG or PNG, up to 2 MB.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <UserAvatar user={user} className="h-20 w-20 text-lg" />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                Change photo
              </Button>
              {user?.avatar_url && (
                <Button variant="ghost" disabled={uploading} onClick={removePhoto}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Contact details</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={saveContact} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx xxxxxxx" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={savingContact}>
                  {savingContact && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save details
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change password</CardTitle>
            <CardDescription>Enter your current password, then choose a new one (min. 6 characters).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="grid gap-4 sm:max-w-sm">
              <div className="space-y-1.5">
                <Label htmlFor="cur">Current password</Label>
                <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new">New password</Label>
                <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conf">Confirm new password</Label>
                <Input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              <div>
                <Button type="submit" disabled={savingPw}>
                  {savingPw && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
