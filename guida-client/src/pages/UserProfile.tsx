import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User, ThumbsUp, Map, Copy, Check, Edit3, Save, X, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { getMyProfile, getUserProfile, updateUserProfile, likedCodes, ApiError } from "@/api/routes";
import type { UserProfileResponse } from "@/api/routes";
import { RouteCard } from "@/components/route/RouteCard";
import { routeStats } from "@/hooks/useRouteFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { ServerUnavailableError } from "@/api/client";

export function UserProfile() {
  const { uuid: routeUuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMe, setIsMe] = useState(false);

  // Profile Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [nickname, setNickname] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Route Interaction State
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [copiedUuid, setCopiedUuid] = useState(false);

  const { myRoutes, likeHubRoute, importByCode, loadMyRoutes } = useRouteStore();
  const { uuid: deviceUuid, settings } = useAppStore();
  const currentPatch = settings.current_patch;

  useEffect(() => {
    void loadMyRoutes();
  }, [loadMyRoutes]);

  const savedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const r of myRoutes) {
      if (r.shared_code) set.add(r.shared_code);
      if (r.imported_from) set.add(r.imported_from);
    }
    return set;
  }, [myRoutes]);

  const liked = likedCodes(deviceUuid, currentPatch);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch current user's profile to identify ourselves
      let myProfileData: UserProfileResponse | null = null;
      try {
        myProfileData = await getMyProfile();
      } catch (e) {
        console.error("Failed to load my profile", e);
      }

      // 2. Fetch the target profile
      if (routeUuid === "me") {
        setIsMe(true);
        if (myProfileData) {
          setProfile(myProfileData);
          setNickname(myProfileData.nickname);
          setDescription(myProfileData.description || "");
        } else {
          throw new Error("내 프로필을 불러오지 못했습니다. 서버 상태를 확인해 주세요.");
        }
      } else {
        const targetProfile = await getUserProfile(routeUuid!);
        setProfile(targetProfile);

        const matchesMe = myProfileData && targetProfile.uuid === myProfileData.uuid;
        setIsMe(!!matchesMe);
        if (matchesMe) {
          setNickname(targetProfile.nickname);
          setDescription(targetProfile.description || "");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로필을 불러오는데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [routeUuid]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const handleCopyUuid = async () => {
    if (!profile) return;
    await navigator.clipboard.writeText(profile.uuid);
    setCopiedUuid(true);
    toast.success("식별 코드를 복사했습니다.");
    setTimeout(() => setCopiedUuid(false), 1500);
  };

  const handleSaveProfile = async () => {
    const trimmedNick = nickname.trim();
    if (!trimmedNick) {
      toast.error("닉네임은 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      await updateUserProfile(trimmedNick, description);
      toast.success("프로필을 수정했습니다.");
      setIsEditing(false);
      await fetchProfile(); // Reload
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("프로필 수정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleLike = async (c: string) => {
    setLikeBusy(c);
    try {
      await likeHubRoute(c);
      toast.success("추천했습니다. 고마워요!");
      // Update local profile route stats to increment likes count instantly
      if (profile) {
        setProfile({
          ...profile,
          routes: profile.routes.map((r) => {
            if (r.route_code === c) {
              const currentLikes = r.stats[currentPatch]?.likes ?? 0;
              return {
                ...r,
                stats: {
                  ...r.stats,
                  [currentPatch]: {
                    ...(r.stats[currentPatch] || { play_count: 0 }),
                    likes: currentLikes + 1,
                  },
                },
              };
            }
            return r;
          }),
        });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE") toast.error("이미 추천한 루트입니다.");
      else if (e instanceof ServerUnavailableError) toast.error(e.message);
      else toast.error("추천 처리 중 오류가 발생했습니다.");
    } finally {
      setLikeBusy(null);
    }
  };

  const handleImport = async (c: string) => {
    if (savedCodes.has(c)) return toast.info("이미 내 루트로 가져온 루트입니다.");
    try {
      const r = await importByCode(c);
      toast.success(`'${r.name}'을(를) 내 루트로 가져왔습니다.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_FOUND") toast.error("루트를 찾을 수 없습니다.");
      else toast.error("가져오기에 실패했습니다.");
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <div className="text-center flex flex-col items-center gap-2">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm">프로필 불러오는 중…</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-xl p-6 text-center">
        <p className="mb-4 text-sm text-destructive">{error || "프로필을 불러오지 못했습니다."}</p>
        <Button onClick={() => navigate(-1)} variant="outline">
          <ArrowLeft className="mr-2 size-4" />
          뒤로 가기
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} title="뒤로 가기">
          <ArrowLeft className="size-5" />
        </Button>
        <h2 className="text-xl font-bold">유저 프로필</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        {/* Profile Details Sidebar */}
        <div className="space-y-4">
          <Card className="border border-border/60 bg-card/50 backdrop-blur-md">
            <CardContent className="pt-6 flex flex-col items-center">
              {/* Avatar Icon */}
              <div className="relative mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500/20 to-red-500/20 border border-primary/20 text-primary">
                <User className="size-10" />
              </div>

              {/* Editing Mode */}
              {isEditing ? (
                <div className="w-full space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">닉네임</label>
                    <Input
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      maxLength={50}
                      placeholder="닉네임 입력"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">소개글</label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={500}
                      placeholder="자신에 대해 적어주세요."
                      className="min-h-[80px] text-xs resize-none"
                    />
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <Button onClick={handleSaveProfile} disabled={saving} size="sm" className="flex-1 gap-1">
                      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                      저장
                    </Button>
                    <Button onClick={() => setIsEditing(false)} variant="outline" size="sm" className="flex-1 gap-1">
                      <X className="size-3.5" />
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="w-full text-center space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground leading-tight">{profile.nickname}</h3>
                    <p className="mt-1 flex items-center justify-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                      <span>식별 코드: {profile.uuid}</span>
                      <button
                        onClick={handleCopyUuid}
                        className="rounded p-0.5 hover:bg-muted hover:text-foreground transition-colors"
                        title="식별 코드 복사"
                      >
                        {copiedUuid ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                      </button>
                    </p>
                  </div>

                  {/* Bio Description */}
                  <div className="rounded-lg border border-border/30 bg-muted/20 p-3 text-left">
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                      {profile.description || "작성된 소개글이 없습니다."}
                    </p>
                  </div>

                  {/* Edit Button */}
                  {isMe && (
                    <Button onClick={() => setIsEditing(true)} size="sm" variant="outline" className="w-full gap-1.5">
                      <Edit3 className="size-3.5" />
                      프로필 수정
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* User Stats Card */}
          <Card className="border border-border/60 bg-card/50 backdrop-blur-md">
            <CardContent className="pt-5 space-y-3.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <ThumbsUp className="size-4 text-primary" />
                  받은 추천수
                </span>
                <span className="font-bold text-foreground">{profile.likes_received}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Map className="size-4 text-emerald-500" />
                  등록한 루트 수
                </span>
                <span className="font-bold text-foreground">{profile.routes.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* User Routes List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Map className="size-4.5 text-primary" />
              만든 루트
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-semibold">
                {profile.routes.length}
              </span>
            </h3>
          </div>

          {profile.routes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center bg-card/25">
              <p className="text-sm text-muted-foreground">아직 등록한 공유 루트가 없습니다.</p>
            </div>
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2">
              {profile.routes.map((route) => {
                const { likes, plays } = routeStats(route, { patch: "all" } as any, currentPatch);
                return (
                  <RouteCard
                    key={route.route_code}
                    route={route}
                    currentPatch={currentPatch}
                    likes={likes}
                    plays={plays}
                    liked={liked.has(route.route_code)}
                    saved={savedCodes.has(route.route_code)}
                    likeBusy={likeBusy === route.route_code}
                    onLike={handleLike}
                    onImport={handleImport}
                    buttonsOnNewLine={true}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
