CREATE OR REPLACE FUNCTION generate_project_number()
RETURNS TRIGGER AS $$
DECLARE
  v_year TEXT;
  v_max_num INTEGER;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  
  SELECT COALESCE(MAX(
    CASE 
      WHEN project_number LIKE 'PRJ-' || v_year || '-%' 
      THEN NULLIF(SUBSTRING(project_number FROM 8), '')::INTEGER 
      ELSE 0 
    END
  ), 0) + 1 INTO v_max_num
  FROM projects
  WHERE project_number LIKE 'PRJ-' || v_year || '-%';
  
  NEW.project_number := 'PRJ-' || v_year || '-' || LPAD(v_max_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;