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
// =========================================================
// PHASE 1 — EMPLOYEES, SCHEDULES, AIRLINES, ASSIGNMENTS
// =========================================================

export async function loadShifts() {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Shift load failed:', error);
    return [];
  }

  return data || [];
}

export async function loadEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select(`
      *,
      shifts (
        id,
        name,
        start_time,
        end_time,
        balance_group
      )
    `)
    .order('name', { ascending: true });

  if (error) {
    console.error('Employee load failed:', error);
    return [];
  }

  return data || [];
}

export async function saveEmployee(employee) {
  const payload = {
    name: employee.name.trim(),
    shift_id: employee.shift_id || null,
    team_role: employee.team_role || 'Surveyor',
    active: employee.active !== false,
    notes: employee.notes?.trim() || null,
    updated_at: new Date().toISOString()
  };

  let query;

  if (employee.id) {
    query = supabase
      .from('employees')
      .update(payload)
      .eq('id', employee.id)
      .select()
      .single();
  } else {
    query = supabase
      .from('employees')
      .insert(payload)
      .select()
      .single();
  }

  const { data, error } = await query;

  if (error) {
    console.error('Employee save failed:', error);
    throw error;
  }

  return data;
}

export async function deleteEmployee(employeeId) {
  const { error } = await supabase
    .from('employees')
    .delete()
    .eq('id', employeeId);

  if (error) {
    console.error('Employee delete failed:', error);
    throw error;
  }

  return true;
}

export async function loadEmployeeSchedule(employeeId) {
  const { data, error } = await supabase
    .from('employee_schedule')
    .select('*')
    .eq('employee_id', employeeId)
    .order('weekday', { ascending: true });

  if (error) {
    console.error('Employee schedule load failed:', error);
    return [];
  }

  return data || [];
}

export async function saveEmployeeSchedule(employeeId, schedule) {
  const rows = schedule.map(day => ({
    employee_id: employeeId,
    weekday: day.weekday,
    working: day.working,
    updated_at: new Date().toISOString()
  }));

  const { data, error } = await supabase
    .from('employee_schedule')
    .upsert(rows, {
      onConflict: 'employee_id,weekday'
    })
    .select();

  if (error) {
    console.error('Employee schedule save failed:', error);
    throw error;
  }

  return data || [];
}

export async function loadAirlines() {
  const { data, error } = await supabase
    .from('airlines')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) {
    console.error('Airline load failed:', error);
    return [];
  }

  return data || [];
}

export async function loadAssignmentsForWeek(startDate, endDate) {
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      *,
      employees (
        id,
        name,
        shift_id
      ),
      assignment_details (
        id,
        survey_type,
        required_count,
        focus_airline_id,
        focus_window,
        notes,
        airlines (
          id,
          code,
          name
        )
      )
    `)
    .gte('assignment_date', startDate)
    .lte('assignment_date', endDate)
    .order('assignment_date', { ascending: true });

  if (error) {
    console.error('Weekly assignment load failed:', error);
    return [];
  }

  return data || [];
}

export async function saveDailyAssignment({
  employeeId,
  assignmentDate,
  status = 'Draft',
  managerNotes = '',
  details = []
}) {
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .upsert(
      {
        employee_id: employeeId,
        assignment_date: assignmentDate,
        status,
        manager_notes: managerNotes.trim() || null,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'employee_id,assignment_date'
      }
    )
    .select()
    .single();

  if (assignmentError) {
    console.error('Assignment save failed:', assignmentError);
    throw assignmentError;
  }

  const detailRows = details.map(detail => ({
    assignment_id: assignment.id,
    survey_type: detail.survey_type,
    required_count: Number(detail.required_count) || 0,
    focus_airline_id: detail.focus_airline_id || null,
    focus_window: detail.focus_window || null,
    notes: detail.notes?.trim() || null,
    updated_at: new Date().toISOString()
  }));

  if (detailRows.length) {
    const { error: detailError } = await supabase
      .from('assignment_details')
      .upsert(detailRows, {
        onConflict: 'assignment_id,survey_type'
      });

    if (detailError) {
      console.error('Assignment detail save failed:', detailError);
      throw detailError;
    }
  }

  return assignment;
}

// =========================================================
// MANAGER MESSAGES
// =========================================================

export async function loadManagerMessages() {
  const { data, error } = await supabase
    .from('manager_messages')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Manager message load failed:', error);
    throw error;
  }

  return data || [];
}

export async function saveManagerMessage({
  id,
  title,
  messageBody,
  audienceType,
  recipientEmployeeIds = [],
  startsOn,
  expiresOn = null,
  active = true
}) {
  const payload = {
    title: title.trim(),
    message_body: messageBody.trim(),
    audience_type: audienceType,
    recipient_employee_ids:
      audienceType === 'individual' ? recipientEmployeeIds : [],
    starts_on: startsOn,
    expires_on: expiresOn || null,
    active,
    updated_at: new Date().toISOString()
  };

  const query = id
    ? supabase
        .from('manager_messages')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
    : supabase
        .from('manager_messages')
        .insert(payload)
        .select()
        .single();

  const { data, error } = await query;

  if (error) {
    console.error('Manager message save failed:', error);
    throw error;
  }

  return data;
}

export async function deactivateManagerMessage(messageId) {
  const { data, error } = await supabase
    .from('manager_messages')
    .update({
      active: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', messageId)
    .select()
    .single();

  if (error) {
    console.error('Manager message deactivation failed:', error);
    throw error;
  }

  return data;
}
