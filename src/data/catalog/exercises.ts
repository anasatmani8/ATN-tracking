import type { Equipment, InputType, LoadConvention } from '@/domain/types';

export type Pattern = 'squat' | 'hinge' | 'lunge' | 'push_horizontal' | 'push_vertical' | 'pull_horizontal' | 'pull_vertical' | 'core' | 'arms' | 'shoulders' | 'calves' | 'carry' | 'cardio';

export interface Exercise {
  id: string;
  name: string;
  equipment: Equipment;
  pattern: Pattern;
  inputType: InputType;
  loadConvention: LoadConvention;
  implementCount: number;
  cues: string;
  builtin: boolean;
}

type T = [id: string, name: string, equipment: Equipment, pattern: Pattern, kind: 'total' | 'pair' | 'bw' | 'time' | 'dist', cues: string];

/** Original cue text written for this app. Reviewed list; no media is bundled, so no media controls are shown. */
const RAW: T[] = [
  // Bodyweight
  ['bw_squat', 'Bodyweight Squat', 'bodyweight', 'squat', 'bw', 'Feet about shoulder width. Sit down between your hips, keep your whole foot on the floor, stand up tall.'],
  ['push_up', 'Push-Up', 'bodyweight', 'push_horizontal', 'bw', 'Hands under shoulders, body in one line. Lower your chest between your hands and press the floor away.'],
  ['incline_push_up', 'Incline Push-Up', 'bodyweight', 'push_horizontal', 'bw', 'Hands on a bench or sturdy surface. Keep your body straight and lower your chest to the edge.'],
  ['pull_up', 'Pull-Up', 'bodyweight', 'pull_vertical', 'bw', 'Start from a full hang. Pull your elbows down toward your ribs until your chin clears the bar, then lower with control.'],
  ['chin_up', 'Chin-Up', 'bodyweight', 'pull_vertical', 'bw', 'Palms facing you. Pull your chest toward the bar and lower to straight arms.'],
  ['inverted_row', 'Inverted Row', 'bodyweight', 'pull_horizontal', 'bw', 'Hang under a bar with a straight body. Pull your chest to the bar and pause briefly.'],
  ['dip', 'Dip', 'bodyweight', 'push_vertical', 'bw', 'Support yourself on straight arms. Lower until your upper arms are about level, then press back up.'],
  ['glute_bridge', 'Glute Bridge', 'bodyweight', 'hinge', 'bw', 'Lie on your back, feet flat. Push through your heels and lift your hips until your body is straight.'],
  ['reverse_lunge_bw', 'Reverse Lunge', 'bodyweight', 'lunge', 'bw', 'Step back, lower both knees, and push through the front foot to stand. Count reps per side.'],
  ['plank', 'Plank', 'bodyweight', 'core', 'time', 'Forearms down, body in one line from head to heels. Breathe steadily and stop when your hips sag.'],
  ['side_plank', 'Side Plank', 'bodyweight', 'core', 'time', 'Elbow under shoulder, hips lifted. Hold each side for the logged time.'],
  ['dead_bug', 'Dead Bug', 'bodyweight', 'core', 'bw', 'On your back, lower opposite arm and leg slowly while your lower back stays on the floor.'],
  ['hanging_knee_raise', 'Hanging Knee Raise', 'bodyweight', 'core', 'bw', 'Hang from a bar and lift your knees toward your chest without swinging.'],
  ['mountain_climber', 'Mountain Climber', 'bodyweight', 'cardio', 'time', 'From a push-up position, alternate driving your knees forward at a pace you can keep.'],
  // Dumbbell
  ['db_goblet_squat', 'Goblet Squat', 'dumbbell', 'squat', 'total', 'Hold one dumbbell against your chest. Squat between your hips with your elbows inside your knees.'],
  ['db_bench_press', 'Dumbbell Bench Press', 'dumbbell', 'push_horizontal', 'pair', 'Lie on a bench with a dumbbell in each hand. Lower to chest level and press up over your shoulders.'],
  ['db_floor_press', 'Dumbbell Floor Press', 'dumbbell', 'push_horizontal', 'pair', 'Lie on the floor. Lower until your upper arms touch the floor, pause, and press up.'],
  ['db_incline_press', 'Incline Dumbbell Press', 'dumbbell', 'push_horizontal', 'pair', 'Set the bench to a low incline. Press the dumbbells up over your upper chest.'],
  ['db_shoulder_press', 'Dumbbell Shoulder Press', 'dumbbell', 'push_vertical', 'pair', 'Start at shoulder height and press overhead until your arms are straight. Keep your ribs down.'],
  ['db_row', 'One-Arm Dumbbell Row', 'dumbbell', 'pull_horizontal', 'total', 'Support yourself on a bench. Pull the dumbbell toward your hip and lower it fully. Count reps per side.'],
  ['db_rdl', 'Dumbbell Romanian Deadlift', 'dumbbell', 'hinge', 'pair', 'Soft knees, push your hips back and slide the dumbbells down your legs. Stand tall to finish.'],
  ['db_split_squat', 'Dumbbell Split Squat', 'dumbbell', 'lunge', 'pair', 'Stagger your stance. Lower straight down and push through the front foot. Count reps per side.'],
  ['db_lateral_raise', 'Lateral Raise', 'dumbbell', 'shoulders', 'pair', 'Raise the dumbbells out to your sides to shoulder height with a slight elbow bend.'],
  ['db_curl', 'Dumbbell Curl', 'dumbbell', 'arms', 'pair', 'Keep your elbows by your sides. Curl up without swinging and lower slowly.'],
  ['db_triceps_ext', 'Overhead Triceps Extension', 'dumbbell', 'arms', 'total', 'Hold one dumbbell overhead with both hands. Bend your elbows to lower it behind your head, then straighten.'],
  ['db_farmer_carry', 'Farmer Carry', 'dumbbell', 'carry', 'dist', 'Stand tall with a dumbbell in each hand and walk with short, steady steps.'],
  ['db_calf_raise', 'Dumbbell Calf Raise', 'dumbbell', 'calves', 'pair', 'Rise onto the balls of your feet, pause at the top, and lower your heels fully.'],
  // Barbell
  ['bb_back_squat', 'Back Squat', 'barbell', 'squat', 'total', 'Bar on your upper back. Brace, sit down to a depth you control, and drive up through your whole foot.'],
  ['bb_front_squat', 'Front Squat', 'barbell', 'squat', 'total', 'Bar on the front of your shoulders, elbows high. Stay upright as you squat.'],
  ['bb_bench_press', 'Bench Press', 'barbell', 'push_horizontal', 'total', 'Feet planted, shoulder blades back. Lower the bar to your mid chest and press up. Use safeties or a spotter.'],
  ['bb_incline_bench', 'Incline Bench Press', 'barbell', 'push_horizontal', 'total', 'Bench at a low incline. Lower the bar to your upper chest and press up.'],
  ['bb_overhead_press', 'Overhead Press', 'barbell', 'push_vertical', 'total', 'Bar at your collarbone. Squeeze your glutes and press straight overhead.'],
  ['bb_deadlift', 'Deadlift', 'barbell', 'hinge', 'total', 'Bar over mid-foot. Brace, push the floor away, and stand up with the bar close to your legs.'],
  ['bb_rdl', 'Romanian Deadlift', 'barbell', 'hinge', 'total', 'From standing, push your hips back with soft knees until you feel your hamstrings, then stand.'],
  ['bb_row', 'Barbell Row', 'barbell', 'pull_horizontal', 'total', 'Hinge forward with a flat back. Pull the bar to your lower ribs and lower with control.'],
  ['bb_hip_thrust', 'Hip Thrust', 'barbell', 'hinge', 'total', 'Upper back on a bench, bar over your hips. Drive your hips up until your torso is level.'],
  // Machine / cable
  ['leg_press', 'Leg Press', 'machine', 'squat', 'total', 'Feet flat on the platform. Lower under control and press without locking your knees hard.'],
  ['leg_curl', 'Leg Curl', 'machine', 'hinge', 'total', 'Curl the pad toward you, pause, and return slowly.'],
  ['leg_extension', 'Leg Extension', 'machine', 'squat', 'total', 'Straighten your knees, pause at the top, and lower slowly.'],
  ['lat_pulldown', 'Lat Pulldown', 'machine', 'pull_vertical', 'total', 'Pull the bar to your upper chest, elbows down and back, then let your arms straighten.'],
  ['seated_cable_row', 'Seated Cable Row', 'cable', 'pull_horizontal', 'total', 'Sit tall. Pull the handle to your stomach and reach forward under control.'],
  ['machine_chest_press', 'Machine Chest Press', 'machine', 'push_horizontal', 'total', 'Handles at mid-chest height. Press forward and return until you feel a comfortable stretch.'],
  ['cable_fly', 'Cable Fly', 'cable', 'push_horizontal', 'pair', 'Slight elbow bend. Bring your hands together in front of your chest and open slowly.'],
  ['cable_pushdown', 'Triceps Pushdown', 'cable', 'arms', 'total', 'Elbows at your sides. Push the handle down until your arms are straight.'],
  ['cable_face_pull', 'Face Pull', 'cable', 'shoulders', 'total', 'Pull the rope toward your face with your elbows high and pause briefly.'],
  ['machine_calf_raise', 'Calf Raise Machine', 'machine', 'calves', 'total', 'Rise as high as you can, pause, and lower your heels fully.'],
  ['assisted_pull_up', 'Assisted Pull-Up', 'machine', 'pull_vertical', 'bw', 'Log the assistance as an assisted load. Pull your chest toward the bar and lower fully.'],
  // Cardio
  ['treadmill_run', 'Treadmill Run', 'cardio', 'cardio', 'dist', 'Choose a pace you can speak at for easy sessions. Log distance and time.'],
  ['outdoor_walk', 'Walk', 'cardio', 'cardio', 'dist', 'A steady walk. Log distance and time.'],
  ['stationary_bike', 'Stationary Bike', 'cardio', 'cardio', 'dist', 'Set the seat so your knee is slightly bent at the bottom. Log distance and time.'],
  ['rowing_machine', 'Rowing Machine', 'cardio', 'cardio', 'dist', 'Push with your legs first, then lean back and pull. Reverse the order on the way forward.'],
  ['jump_rope', 'Jump Rope', 'cardio', 'cardio', 'time', 'Small jumps, wrists turning the rope. Log total time.'],
];

const KIND: Record<T[4], { inputType: InputType; loadConvention: LoadConvention; implementCount: number }> = {
  total: { inputType: 'weight_reps', loadConvention: 'total', implementCount: 1 },
  pair: { inputType: 'weight_reps', loadConvention: 'per_implement', implementCount: 2 },
  bw: { inputType: 'bodyweight_reps', loadConvention: 'bodyweight', implementCount: 1 },
  time: { inputType: 'duration', loadConvention: 'none', implementCount: 1 },
  dist: { inputType: 'distance_duration', loadConvention: 'none', implementCount: 1 },
};

export const BUILTIN_EXERCISES: Exercise[] = RAW.map(([id, name, equipment, pattern, kind, cues]) => ({
  id, name, equipment, pattern, cues, builtin: true, ...KIND[kind],
}));

const byId = new Map(BUILTIN_EXERCISES.map((e) => [e.id, e]));
export const builtinExercise = (id: string) => byId.get(id) ?? null;
