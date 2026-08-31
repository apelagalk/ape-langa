/* =========================================================
   APE LANGA – PRODUCTION SUPABASE ADAPTER
   Keeps the existing HTML/localStorage prototype UI intact,
   while providing production authentication, data access,
   Realtime, and PayHere checkout integration.
   ========================================================= */
(function () {
  "use strict";

  const C = window.APE_LANGA_CONFIG || {};
  const configured = C.SUPABASE_URL &&
    C.SUPABASE_ANON_KEY &&
    !String(C.SUPABASE_URL).startsWith("YOUR_") &&
    !String(C.SUPABASE_ANON_KEY).startsWith("YOUR_");

  window.ApeLanga = window.ApeLanga || {};
  window.ApeLanga.productionConfigured = configured;

  if (!configured || !window.supabase) {
    console.info("[Ape Langa] Production Supabase is not configured yet. Prototype fallback remains available.");
    return;
  }

  const client = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  });
  window.apeLangaSupabase = client;

  async function currentUser() {
    const { data } = await client.auth.getUser();
    return data?.user || null;
  }

  async function profile() {
    const user = await currentUser();
    if (!user) return null;
    const { data } = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    return data || null;
  }

  window.ApeLanga.auth = {
    async register({ email, password, fullName, phone, role = "customer" }) {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { full_name: fullName, phone, role } }
      });
      if (error) throw error;
      return data;
    },
    async login(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async logout() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    currentUser,
    profile
  };

  window.ApeLanga.db = {
    async createMechanic(payload) {
  const user = await currentUser();
  if (!user) throw new Error("Login required.");

  const profileData = await profile();
  if (!profileData?.id) {
    throw new Error("User profile not found.");
  }

  const { data, error } = await client
    .from("mechanics")
    .insert({
      user_id: profileData.id,
      name: payload.name || "",
      phone: payload.phone || null,
      service_types: payload.service_types || [],
      experience: Number(payload.experience || 0),
      online_status: false,
      latitude: payload.latitude || null,
      longitude: payload.longitude || null,
      verification_status: "pending",
      rating: 0
    })
    .select()
    .single();

  if (error) throw error;

  return data;
},
     async createBooking(payload) {
      const user = await currentUser();
      if (!user) throw new Error("Login required.");
      const { data, error } = await client.from("bookings").insert({
        booking_number: "AL-" + Date.now(),
        customer_id: user.id,
        provider_id: payload.provider_id || null,
        mechanic_id: payload.mechanic_id || null,
        vehicle_id: payload.vehicle_id || null,
        accommodation_id: payload.accommodation_id || null,
        booking_type: payload.booking_type,
        start_date: payload.start_date || null,
        end_date: payload.end_date || null,
        start_time: payload.start_time || null,
        duration: payload.duration || null,
        guests: payload.guests || null,
        rooms: payload.rooms || null,
        amount: Number(payload.amount || 0),
        status: "pending",
        customer_note: payload.customer_note || null
      }).select().single();
      if (error) throw error;
      return data;
    },
    async myBookings() {
      const user = await currentUser();
      if (!user) return [];
      const { data, error } = await client.from("bookings")
        .select("*").eq("customer_id", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async createProviderVehicle(payload) {
      const user = await currentUser();
      if (!user) throw new Error("Login required.");
      const { data: provider } = await client.from("providers").select("id")
        .eq("user_id", user.id).maybeSingle();
      if (!provider) throw new Error("Provider profile not found.");
      const { data, error } = await client.from("vehicles").insert({
        provider_id: provider.id, ...payload, availability: payload.availability || "available"
      }).select().single();
      if (error) throw error;
      return data;
    },
    async createAccommodation(payload) {
      const user = await currentUser();
      if (!user) throw new Error("Login required.");
      const { data: provider } = await client.from("providers").select("id")
        .eq("user_id", user.id).maybeSingle();
      if (!provider) throw new Error("Provider profile not found.");
      const { data, error } = await client.from("accommodations").insert({
        provider_id: provider.id, ...payload
      }).select().single();
      if (error) throw error;
      return data;
    },
    async addRating(payload) {
      const user = await currentUser();
      if (!user) throw new Error("Login required.");
      const { data, error } = await client.from("ratings").insert({
        booking_id: payload.booking_id,
        customer_id: user.id,
        provider_id: payload.provider_id || null,
        mechanic_id: payload.mechanic_id || null,
        rating: Number(payload.rating),
        review: payload.review || null
      }).select().single();
      if (error) throw error;
      return data;
    }
  };

  window.ApeLanga.realtime = {
    subscribeToBooking(bookingId, callback) {
      return client.channel("booking-" + bookingId)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "bookings",
          filter: "id=eq." + bookingId
        }, payload => callback(payload))
        .subscribe();
    },
    subscribeToUserBookings(callback) {
      return client.channel("user-bookings")
        .on("postgres_changes", {
          event: "*", schema: "public", table: "bookings"
        }, payload => callback(payload))
        .subscribe();
    }
  };

  async function startPayHere(bookingId) {
    const { data, error } = await client.functions.invoke("payhere-create-payment", {
      body: { booking_id: bookingId }
    });
    if (error) throw error;
    if (!data?.params) throw new Error("Payment session could not be created.");

    const action = data.action || "https://sandbox.payhere.lk/pay/checkout";
    const form = document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.style.display = "none";
    Object.entries(data.params).forEach(([k, v]) => {
      const input = document.createElement("input");
      input.type = "hidden"; input.name = k; input.value = v ?? "";
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }
  window.ApeLanga.payments = { startPayHere };

  client.auth.onAuthStateChange(async (_event, session) => {
    document.dispatchEvent(new CustomEvent("ape-langa-auth", {
      detail: { session, user: session?.user || null }
    }));
  });

  console.info("[Ape Langa] Production Supabase adapter active.");
})();
