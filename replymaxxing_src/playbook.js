// Post types and goals for the Posts tab pickers (the full playbook lives on the server).
var AB_PLAYBOOK = {
 "STAGES": [
  {
   "id": "attract",
   "name": "Attract",
   "short": "Reach"
  },
  {
   "id": "engage",
   "name": "Engage",
   "short": "Trust"
  },
  {
   "id": "convert",
   "name": "Convert",
   "short": "Leads"
  }
 ],
 "TYPES": [
  {
   "id": "trending",
   "name": "Trending with a twist",
   "stage": "attract",
   "rules": "Take a topic trending right now. Back it with a real fact or number. Look at it through a different, slightly controversial lens. End with a takeaway the audience will repeat."
  },
  {
   "id": "anonymous",
   "name": "Anonymous story",
   "stage": "attract",
   "rules": "A real story about someone left unnamed (so you can share more detail). Hook with a number if possible. Build the rising action, make a bold statement as the climax, finish the story on a positive note, leave a takeaway."
  },
  {
   "id": "perspective",
   "name": "New perspective",
   "stage": "engage",
   "rules": "What the user knew or cared about a few years ago versus now. 3 to 5 contrasts the audience relates to so they think 'that's me'. Leave a takeaway."
  },
  {
   "id": "numbers",
   "name": "Numbers don't lie",
   "stage": "attract",
   "rules": "Paint a picture with numbers from years ago versus today (up or down). The more staggering the gap the better, and it must matter to the audience. Bold statement as the climax, then a takeaway."
  },
  {
   "id": "career",
   "name": "Personal career story",
   "stage": "engage",
   "rules": "An early career moment most people also lived. Strong hook with numbers where possible. If it's a win, tell it humbly. Leave a takeaway people relate to, never one they would resent."
  },
  {
   "id": "conversation",
   "name": "Real conversation",
   "stage": "engage",
   "rules": "Recreate a real conversation with only two characters, keeping only the lines that matter. Short lines. Share the lesson at the end to challenge how people think. Leave a takeaway."
  },
  {
   "id": "oneliner",
   "name": "One-liner",
   "stage": "attract",
   "rules": "One bold statement with no context, about something the audience cares about, built to get people arguing both sides in the comments. No takeaway needed. Always add a short sign off like 'That's all.'"
  },
  {
   "id": "hypothetical",
   "name": "Hypothetical conversation",
   "stage": "engage",
   "rules": "A made up two character exchange about one core pain point the audience has. Each line short and easy to read. Drive to one clear point, then a takeaway."
  },
  {
   "id": "praise",
   "name": "Praise the prospect",
   "stage": "convert",
   "rules": "Hook that names the intended audience. A personal story, told with Freytag's Pyramid, that shows their value. Close with direct appreciation for that audience's expertise or character as the takeaway."
  },
  {
   "id": "chronological",
   "name": "Chronological events",
   "stage": "engage",
   "rules": "Start at the earliest point and walk forward in time, using dates or a timeline. First line is still a scroll stopper. Each line short. Numbers for emphasis. Leave a takeaway."
  },
  {
   "id": "beforeafter",
   "name": "Before & after",
   "stage": "engage",
   "rules": "How something looked before versus after (a mindset, a profile, a job search, a career). Focus on what the audience feels. Leave a takeaway."
  },
  {
   "id": "testimonial",
   "name": "Customer testimonial",
   "stage": "convert",
   "rules": "The story of a client the user got a great result for. Hook that makes people read on. Name big companies if it adds credibility. Show the starting point and the challenge so the impact is clear. Add encouragement for the reader. Leave a takeaway."
  },
  {
   "id": "brag",
   "name": "Brag about someone",
   "stage": "engage",
   "rules": "Celebrate a family member, client, teammate or friend. Feel good hook. Just state the facts with numbers for emphasis. Makes the user more human, which builds trust. Suggest a photo. Leave a takeaway."
  },
  {
   "id": "compare",
   "name": "Average vs amazing",
   "stage": "attract",
   "rules": "Short side by side comparisons (average X vs amazing X). Same opening words on every pair, the twist in the second half of each. Optionally a third column like 'bad'. End with a takeaway."
  },
  {
   "id": "teach",
   "name": "Teach something new",
   "stage": "engage",
   "rules": "Deep dive on one thing the user knows well. Break it into 3 to 5 actionable steps, not high level fluff. Share one resource that helps. Works as a carousel too."
  },
  {
   "id": "screenshot",
   "name": "Share a screenshot",
   "stage": "attract",
   "rules": "React to a post or tweet that already went viral and matches the user's philosophy. Always credit the creator by name. Add only 1 to 2 lines to the thought. Output the reaction text and say what to screenshot."
  },
  {
   "id": "lifestory",
   "name": "Personal life story",
   "stage": "engage",
   "rules": "Something the audience doesn't know about the user yet. Share details but don't expose everything. End with an encouraging thought and a takeaway. Suggest a photo for reach."
  },
  {
   "id": "lifelist",
   "name": "Life list",
   "stage": "attract",
   "rules": "A list of 5 to 10 things the user learned (in their career, business or field), or things he doesn't regret, or priorities. Resonates widely. Invite the audience to add their own in the comments."
  }
 ]
};
AB_PLAYBOOK.typeById = (id) => AB_PLAYBOOK.TYPES.find((t) => t.id === id) || null;
AB_PLAYBOOK.stageById = (id) => AB_PLAYBOOK.STAGES.find((s) => s.id === id) || null;
