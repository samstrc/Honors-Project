"""Request and response shapes for the preapproval API.

`LoanApplication` is the form: the fields an applicant can answer about themselves,
with the credit-bureau ones optional. Everything the model needs beyond this is either
derived from these fields or looked up from the cohort tables.
"""

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Gender(str, Enum):
    male = "M"
    female = "F"


class IncomeType(str, Enum):
    businessman = "Businessman"
    commercial_associate = "Commercial associate"
    maternity_leave = "Maternity leave"
    pensioner = "Pensioner"
    state_servant = "State servant"
    student = "Student"
    unemployed = "Unemployed"
    working = "Working"


class EducationType(str, Enum):
    academic_degree = "Academic degree"
    higher_education = "Higher education"
    incomplete_higher = "Incomplete higher"
    lower_secondary = "Lower secondary"
    secondary = "Secondary / secondary special"


class FamilyStatus(str, Enum):
    civil_marriage = "Civil marriage"
    married = "Married"
    separated = "Separated"
    single = "Single / not married"
    unknown = "Unknown"
    widow = "Widow"


class OccupationType(str, Enum):
    accountants = "Accountants"
    cleaning_staff = "Cleaning staff"
    cooking_staff = "Cooking staff"
    core_staff = "Core staff"
    drivers = "Drivers"
    hr_staff = "HR staff"
    high_skill_tech_staff = "High skill tech staff"
    it_staff = "IT staff"
    laborers = "Laborers"
    low_skill_laborers = "Low-skill Laborers"
    managers = "Managers"
    medicine_staff = "Medicine staff"
    private_service_staff = "Private service staff"
    realty_agents = "Realty agents"
    sales_staff = "Sales staff"
    secretaries = "Secretaries"
    security_staff = "Security staff"
    waiters_barmen_staff = "Waiters/barmen staff"


class LoanApplication(BaseModel):
    """Application-level inputs a preapproval form can realistically collect.

    Trimmed to the fields the served model actually uses. Living situation, contract
    type, car ownership and realty ownership were dropped after a sensitivity sweep
    (utilities/api_limits.py) showed that none of them changed a single model input:
    feature selection had already removed them, and no surviving derived feature depends
    on them. Asking for a field that can't move the prediction costs the applicant
    something and buys nothing.

    Everything else the model was trained on and not listed here -- building/region
    statistics, document flags, and the client's bureau and prior-loan history -- is left
    missing, which LightGBM routes natively. See the module docstring in
    utilities/api_limits.py for what that costs.
    """

    # --- financials ---
    income: float = Field(..., gt=0, description="Gross monthly income, in the dataset's currency units")
    credit_amount: float = Field(..., gt=0, description="Requested loan/credit amount")
    annuity: float = Field(..., gt=0, description="Loan annuity (periodic payment)")
    goods_price: Optional[float] = Field(None, gt=0, description="Price of the goods the loan is for, if applicable")

    # --- demographics ---
    age_years: float = Field(..., gt=17, lt=100)
    gender: Gender
    children: int = Field(0, ge=0)
    family_members: int = Field(1, ge=1)
    family_status: FamilyStatus
    education: EducationType

    # --- employment ---
    income_type: IncomeType
    # Free text rather than an Enum. 58 employer categories is too many to list here, and
    # an unrecognised value is harmless: it falls outside every trained level and is
    # treated as missing.
    organization_type: Optional[str] = Field(
        None, description="Employer category, e.g. 'Business Entity Type 3', 'Self-employed'")
    occupation: Optional[OccupationType] = None
    years_employed: Optional[float] = Field(None, ge=0, description="Leave blank if unemployed/retired/student")

    # --- optional: external credit bureau scores (0-1). A real system would pull these
    # from a bureau; here they are optional, for applicants who happen to know them. ---
    ext_score_1: Optional[float] = Field(None, ge=0, le=1)
    ext_score_2: Optional[float] = Field(None, ge=0, le=1)
    ext_score_3: Optional[float] = Field(None, ge=0, le=1)

    # --- optional: existing credit card utilization, if the applicant has one ---
    cc_utilization: Optional[float] = Field(None, ge=0, description="Existing credit card balance / limit, if applicable")


class FeatureContribution(BaseModel):
    feature: str
    contribution: float  # SHAP value: positive pushes toward default, negative toward safe


class PreapprovalResponse(BaseModel):
    default_probability: float
    threshold: float
    decision: str
    model_used: str
    risk_percentile: int  # this applicant's score vs. real historical applicants, 1-100
    base_rate: float  # the explainer's expected value, in log-odds, before any feature
                      # contributions are added. Not a probability: sigmoid() it first.
    n_contributing: int = 0  # how many features moved the score at all; top_factors is
                             # only the largest few of these
    top_factors: list[FeatureContribution]
