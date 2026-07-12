import { supabase } from './supabaseClient.js';

const STATE_ID = 'surveyops-air-v035';

export async function loadCloudState() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('id', STATE_ID)
    .maybeSingle();

  if (error) {
    console.error('Supabase load failed:', error);
    return null;
  }

  return data?.value || null;
}

export async function saveCloudState(state) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      id: STATE_ID,
      value: state,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('Supabase save failed:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    return false;
  }

  return true;
}

export async function saveSurveyRecord(record) {
  const { error } = await supabase
    .from('survey_records')
    .insert({
      surveyor: record.surveyor,
      survey_type: record.survey_type,
      airport_code: record.airport_code,
      airport_name: record.airport_name,
      city: record.city,
      airline: record.airline,
      flight_number: record.flight_number,
      domestic_international: record.domestic_international
    });

  if (error) {
    console.error('Survey record save failed:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    return false;
  }

  return true;
}