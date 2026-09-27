"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import path
from research import views as research_views
from database import views
from coordination.views import opportunities
from mapping.views import substations, overview

urlpatterns = [
    path("api/projects/", research_views.projects),
    path("api/projects/<str:project_id>/", research_views.detail),
    path("api/projects/<str:project_id>/research/", research_views.research),
    path("api/projects/<str:project_id>/research/<str:run_id>/review/", research_views.review),
    path("api/projects/<str:project_id>/chat/", research_views.ask),
    path("api/map/overview/", overview),
    path("api/map/substations/", substations),
    path("api/opportunities/", opportunities),
    path("api/opportunities/<str:opportunity_id>/analysis/", research_views.pair_analysis),
    path("api/status/", views.status),
    path("api/import/preview/", views.preview),
    path("api/import/commit/", views.commit),
    path("admin/", admin.site.urls),
]
